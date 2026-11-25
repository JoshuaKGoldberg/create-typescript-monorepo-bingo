import semver from 'semver';
import { z } from 'zod';

import { rootBase } from '../../bases/rootBase.ts';
import { defaults, type RootOptions } from '../../options.ts';
import { createSetupSteps } from '../../utils/actions.ts';
import { parseJsonText, readText } from '../../utils/files.ts';
import { getWorkflowPath } from '../../utils/options.ts';
import { formatYamlFile } from '../../utils/yaml.ts';
import { blockRepositoryRuleset } from './blockRepositoryRuleset.ts';

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
 * Gets each lower bound in an `engines.node` range, plus the latest of its major version.
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

  // GitHub Actions rejects empty matrices
  return versions.length ? [...new Set(versions)] : [Number(defaults.node.split('.')[0])];
}

export const blockGitHubActionsCI = rootBase.createBlock({
  about: {
    name: 'GitHub Actions CI',
  },
  intake({ files, options }) {
    const existing = readText(files, `.github/workflows/${getWorkflowPath(options, 'ci')}`);
    const setupAction =
      readText(files, '.github/actions/setup/action.yaml') ??
      readText(files, '.github/actions/setup/action.yml');
    const rootScripts = parseJsonText(readText(files, 'package.json'), 'package.json').scripts as
      | Record<string, string>
      | undefined;
    return {
      ...(existing !== undefined && { existing }),
      ...(rootScripts && { rootScripts }),
      // Existing setup actions may not take the inputs the engines check needs
      ...(setupAction !== undefined &&
        !setupAction.includes('install-flags') && { setupLacksInstallFlags: true }),
    };
  },
  props: {
    existing: z.string().optional(),
    jobs: z.array(ciJobSchema).optional(),
    rootScripts: z.record(z.string(), z.string()).optional(),
    setupLacksInstallFlags: z.boolean().optional(),
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

    // Stratum re-runs Blocks as props change, so the latest version of each job wins.
    // The engines check installs all packages, some of which may need newer Node.js versions.
    const hasUnmanaged = (options.packages ?? []).some(
      (pkg) => pkg.kind === 'site' || pkg.kind === 'repo-owned',
    );
    const byId = new Map<string, CIJob>();
    for (const job of jobs) {
      if (!(job.id === 'engines_check' && (props.setupLacksInstallFlags || hasUnmanaged))) {
        byId.set(job.id, job);
      }
    }

    return {
      extensions: [
        blockRepositoryRuleset({
          requiredStatusChecks: [...byId.values()].flatMap(getStatusChecks),
        }),
      ],
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
                    .map((job) => [job.id, createJob(job, options)]),
                ),
              },
              props.existing,
              {
                name: `.github/workflows/ci.${options.workflowExtension ?? 'yaml'}`,
                nodeEngines: options.nodeEngines ?? defaults.nodeEngines,
                scripts: props.rootScripts,
                sorted: options.workflowKeysSorted,
                workflow: true,
              },
            ).replace('pull_request: null', 'pull_request: ~'),
          },
        },
      },
    };
  },
});

function createJob(job: CIJob, options: RootOptions) {
  return {
    ...(job.if && { if: job.if }),
    name: job.name,
    'runs-on': job.runsOn ?? 'ubuntu-latest',
    ...(job.permissions && { permissions: job.permissions }),
    ...(job.strategy && { strategy: job.strategy }),
    steps: [...createSetupSteps(options, job.setup), ...job.steps],
  };
}

/**
 * Node.js versions change over time, which would leave required checks that never run.
 */
function getStatusChecks(job: CIJob) {
  const matrix = job.strategy?.matrix as Record<string, string[]> | undefined;
  if (!matrix) {
    return [job.name];
  }

  return 'node-version' in matrix
    ? []
    : Object.entries(matrix).flatMap(([key, values]) =>
        values.map((value) => job.name.replace(`\${{ matrix.${key} }}`, value)),
      );
}

function safeMinVersion(range: string) {
  try {
    return semver.minVersion(range.trim().replace(/^v/, '')) ?? undefined;
  } catch {
    return undefined;
  }
}
