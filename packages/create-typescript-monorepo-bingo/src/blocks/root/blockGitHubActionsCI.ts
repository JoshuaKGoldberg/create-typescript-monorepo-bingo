import semver from 'semver';
import { z } from 'zod';

import { rootBase } from '../../bases/rootBase.ts';
import { defaults } from '../../options.ts';
import { readText } from '../../utils/files.ts';
import { getWorkflowPath } from '../../utils/options.ts';
import { formatYamlFile } from '../../utils/yaml.ts';

export const workflowStepSchema = z.object({
  env: z.record(z.string(), z.string()).optional(),
  id: z.string().optional(),
  if: z.string().optional(),
  name: z.string().optional(),
  run: z.string().optional(),
  uses: z.string().optional(),
  with: z.record(z.string(), z.unknown()).optional(),
});

export type WorkflowStep = z.infer<typeof workflowStepSchema>;

export const ciJobSchema = z.object({
  id: z.string(),
  if: z.string().optional(),
  name: z.string(),
  permissions: z.record(z.string(), z.string()).optional(),
  runsOn: z.string().optional(),
  setup: z.record(z.string(), z.unknown()).optional(),
  steps: z.array(workflowStepSchema),
  strategy: z.record(z.string(), z.unknown()).optional(),
});

export type CIJob = z.infer<typeof ciJobSchema>;

/**
 * The shared setup step: bingo's `$/.github/actions/setup`, which checks out,
 * installs pnpm and Node.js, and installs dependencies.
 */
function createSetupStep(inputs?: Record<string, unknown>): WorkflowStep {
  return {
    uses: '$/.github/actions/setup',
    ...(inputs && Object.keys(inputs).length && { with: inputs }),
  };
}

/**
 * Gets the Node.js versions to test, from an `engines.node` range:
 * each lower bound's exact version, plus its major's latest.
 */
export function getNodeVersionsMatrix(nodeEngines: string): (number | string)[] {
  const versions: (number | string)[] = [];

  for (const part of nodeEngines.split('||')) {
    const exact = /\d+\.\d+\.\d+/.exec(part)?.[0];
    const minimum = safeMinVersion(part);
    if (exact) {
      versions.push(exact);
    }
    if (minimum) {
      versions.push(minimum.major);
    }
  }

  // GitHub Actions rejects an empty matrix.
  return versions.length ? [...new Set(versions)] : [Number(defaults.node.split('.')[0])];
}

/**
 * Owns the CI workflow. Other Blocks send jobs to it, each with an explicit id.
 */
export const blockGitHubActionsCI = rootBase.createBlock({
  about: {
    name: 'GitHub Actions CI',
  },
  intake({ files, options }) {
    const existing = readText(files, `.github/workflows/${getWorkflowPath(options, 'ci')}`);
    return existing === undefined ? undefined : { existing };
  },
  props: {
    existing: z.string().optional(),
    jobs: z.array(ciJobSchema).optional(),
  },
  produce({ options, props }) {
    const nodeVersions = getNodeVersionsMatrix(options.nodeEngines ?? defaults.nodeEngines);
    const jobs: CIJob[] = [
      {
        id: 'dedupe_check',
        name: 'Dedupe Check',
        steps: [{ run: 'pnpm dedupe --check' }],
      },
      {
        id: 'engines_check',
        name: 'Engines Check (Node.js ${{ matrix.node-version }})',
        setup: {
          cache: false,
          'install-flags': '--prod --engine-strict --ignore-scripts',
          'node-version': '${{ matrix.node-version }}',
        },
        steps: [],
        strategy: { 'fail-fast': false, matrix: { 'node-version': nodeVersions } },
      },
      ...(props.jobs ?? []),
    ];

    // Stratum re-runs a Block whenever its props change, and job arrays only grow,
    // so an earlier version of a job can still be in props: the latest one wins.
    const byId = new Map<string, CIJob>();
    for (const job of jobs) {
      byId.set(job.id, job);
    }

    return {
      files: {
        '.github': {
          workflows: {
            [getWorkflowPath(options, 'ci')]: formatYamlFile(
              {
                name: 'CI',
                on: {
                  pull_request: null,
                  push: { branches: ['main'] },
                },
                permissions: { contents: 'read' },
                jobs: Object.fromEntries(
                  [...byId.values()]
                    .sort((a, b) => a.id.localeCompare(b.id))
                    .map((job) => [job.id, createJob(job)]),
                ),
              },
              props.existing,
              {
                name: `.github/workflows/ci.${options.workflowExtension ?? 'yaml'}`,
                workflow: true,
              },
            ).replace('pull_request: null', 'pull_request: ~'),
          },
        },
      },
    };
  },
});

function createJob(job: CIJob) {
  return {
    ...(job.if && { if: job.if }),
    name: job.name,
    'runs-on': job.runsOn ?? 'ubuntu-latest',
    ...(job.permissions && { permissions: job.permissions }),
    ...(job.strategy && { strategy: job.strategy }),
    steps: [createSetupStep(job.setup), ...job.steps],
  };
}

function safeMinVersion(range: string) {
  try {
    return semver.minVersion(range.trim().replace(/^v/, '')) ?? undefined;
  } catch {
    return undefined;
  }
}
