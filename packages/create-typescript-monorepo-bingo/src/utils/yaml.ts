import semver from 'semver';
import { type Document, isMap, isNode, isScalar, isSeq, parseDocument, stringify } from 'yaml';

import { annotateActionVersions } from './actions.ts';

/**
 * Stringifies a value as YAML in the style oxfmt and Prettier use.
 */
export function formatYaml(value: unknown): string {
  return annotateActionVersions(stringify(value, { lineWidth: 0, singleQuote: true }));
}

/**
 * Stringifies a GitHub Actions workflow, with blank lines between top-level keys
 * and between jobs, as hand-written workflows usually have.
 */
export function formatWorkflow(value: unknown): string {
  const lines = formatYaml(value).trimEnd().split('\n');
  const output: string[] = [];
  let inJobs = false;

  for (const [index, line] of lines.entries()) {
    const isTopLevel = /^\S/.test(line);
    const isJob = inJobs && /^ {2}\S/.test(line);

    if (index > 0 && (isTopLevel || isJob) && !line.startsWith('-') && output.at(-1) !== 'jobs:') {
      output.push('');
    }

    if (isTopLevel) {
      inJobs = line === 'jobs:';
    }

    output.push(line);
  }

  return `${output.join('\n')}\n`;
}

/**
 * Formats a YAML file CTM produces.
 * - A new file is printed fresh: as a workflow, with blank lines, if `workflow` is set.
 * - An existing workflow is the repository's: CTM only adds jobs it doesn't find
 *   (matching ids that differ only in `-` vs `_`), and keeps the Node.js versions
 *   matrix of jobs it does find in line with `engines.node`. Nothing else changes, so
 *   comments, settings, steps and formatting are all kept.
 * - Any other existing YAML file is kept as it is.
 * @throws If an existing file can't be parsed.
 */
export function formatYamlFile(
  value: unknown,
  existingText: string | undefined,
  {
    name,
    nodeEngines,
    scripts = {},
    workflow = false,
  }: {
    name?: string;
    nodeEngines?: string;
    scripts?: Record<string, string>;
    workflow?: boolean;
  } = {},
): string {
  if (existingText === undefined) {
    return workflow ? formatWorkflow(value) : formatYaml(value);
  }

  const document = parseDocument(existingText);
  if (document.errors.length) {
    throw new Error(
      `Could not parse ${name ?? 'a YAML file'}: ${document.errors[0]?.message ?? ''} Fix it, then re-run.`,
    );
  }

  if (!workflow || !isPlainObject(value) || !isPlainObject(value.jobs)) {
    return existingText;
  }

  const jobs = document.get('jobs');
  if (!isMap(jobs)) {
    return existingText;
  }

  const spaced = jobs.items.slice(1).some((pair) => isNode(pair.key) && pair.key.spaceBefore);
  let changed = false;

  for (const [id, job] of Object.entries(value.jobs)) {
    const existing = jobs.items.find(
      (pair) => normalizeJobId(keyText(pair.key)) === normalizeJobId(id),
    );

    if (existing) {
      changed = syncNodeVersions(document, existing.value, job, nodeEngines) || changed;
      continue;
    }

    // A job that does the same thing under another id, like typecheck for type_check,
    // or another job running the same action, is the repository's version of it.
    if (hasEquivalentJob(document.toJS() as unknown, job, scripts)) {
      continue;
    }

    const created = document.createPair(id, job);
    if (spaced && isNode(created.key)) {
      created.key.spaceBefore = true;
    }
    jobs.items.push(created);
    changed = true;
  }

  return changed
    ? annotateActionVersions(
        document
          .toString({ flowCollectionPadding: false, lineWidth: 0, singleQuote: true })
          .replaceAll(/[ \t]+$/gm, ''),
      )
    : existingText;
}

/**
 * Updates an existing job's `strategy.matrix.node-version` list to CTM's, which follows
 * `engines.node`. Other matrices, and versions written as expressions, are kept.
 */
function syncNodeVersions(
  document: Document,
  node: unknown,
  job: unknown,
  nodeEngines: string | undefined,
) {
  const ours = isPlainObject(job)
    ? getPath(job, ['strategy', 'matrix', 'node-version'])
    : undefined;
  if (!Array.isArray(ours) || !isMap(node)) {
    return false;
  }

  const existing = node.getIn(['strategy', 'matrix', 'node-version'], true);
  if (!isSeq(existing)) {
    return false;
  }

  // Existing versions that engines.node still allows are kept; ones it doesn't are
  // removed, and CTM's own are added.
  const kept = existing.items.filter(
    (item) =>
      !isScalar(item) || nodeEngines === undefined || allowsNodeVersion(nodeEngines, item.value),
  );
  const values = new Set(kept.map((item) => (isScalar(item) ? String(item.value) : item)));
  const added = ours.filter((version) => !values.has(String(version)));

  if (kept.length === existing.items.length && !added.length) {
    return false;
  }

  // New versions go in ascending position among the kept ones, so sorted lists stay sorted.
  const items = [...kept];
  for (const version of added) {
    const target = semver.coerce(String(version));
    // Before the first larger entry, or before its own major (like 22.22.2 before 22),
    // matching the minimum-then-major order CTM writes.
    const index = items.findIndex((item) => {
      const value = isScalar(item) ? String(item.value) : '';
      const current = semver.coerce(value);
      return (
        !!target &&
        !!current &&
        (semver.gt(current, target) || (/^\d+$/.test(value) && current.major === target.major))
      );
    });
    items.splice(index === -1 ? items.length : index, 0, document.createNode(version));
  }
  existing.items = items;
  return true;
}

function getPath(value: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    current = isPlainObject(current) ? current[key] : undefined;
  }
  return current;
}

function normalizeJobId(id: string) {
  return id.toLowerCase().replaceAll(/[-_]/g, '');
}

function hasEquivalentJob(workflow: unknown, job: unknown, scripts: Record<string, string>) {
  const existingJobs = isPlainObject(workflow) && isPlainObject(workflow.jobs) ? workflow.jobs : {};
  const ours = getSteps(job);
  const actions = ours.flatMap((step) => (step.uses ? [normalizeUses(step.uses)] : []));
  const distinctive = actions.filter(
    (uses) => !uses.startsWith('$/') && !uses.startsWith('./') && uses !== 'actions/checkout',
  );
  const runs = ours.flatMap((step) => (step.run ? [normalizeRun(step.run, scripts)] : []));

  return Object.values(existingJobs).some((existingJob) => {
    const steps = getSteps(existingJob);
    const existingActions = new Set(
      steps.flatMap((step) => (step.uses ? [normalizeUses(step.uses)] : [])),
    );
    const existingRuns = new Set(
      steps.flatMap((step) => (step.run ? [normalizeRun(step.run, scripts)] : [])),
    );
    return (
      (distinctive.length > 0 && distinctive.every((uses) => existingActions.has(uses))) ||
      (runs.length > 0 && runs.every((run) => existingRuns.has(run)))
    );
  });
}

function getSteps(job: unknown): { run?: string; uses?: string }[] {
  return isPlainObject(job) && Array.isArray(job.steps) ? flattenSteps(job.steps) : [];
}

/**
 * Flattens steps, including ones nested in groups like `parallel:`.
 */
function flattenSteps(steps: unknown[]): { run?: string; uses?: string }[] {
  return steps.flatMap((step) => {
    if (!isPlainObject(step)) {
      return [];
    }

    const nested = Object.values(step).filter((value) => Array.isArray(value));
    return [step, ...nested.flatMap((value) => flattenSteps(value as unknown[]))];
  });
}

function normalizeUses(uses: string) {
  const at = uses.indexOf('@', 1);
  return (at === -1 ? uses : uses.slice(0, at)).toLowerCase();
}

/**
 * Normalizes a command, expanding a pnpm script to what it runs, so \`pnpm typecheck\`
 * and \`pnpm exec tsc -b\` compare equal when the typecheck script is \`tsc -b\`.
 */
function normalizeRun(run: string, scripts: Record<string, string>): string {
  const command = run.trim().replace(/^(?:pnpm (?:run |exec )?|npx )/, '');
  const [name = '', ...args] = command.split(/\s+/);
  const script = scripts[name];
  return script && script !== command
    ? normalizeRun([script, ...args].join(' '), {})
    : command.replaceAll(/\s+/g, ' ');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function keyText(key: unknown) {
  return isScalar(key) ? String(key.value) : String(key);
}

/**
 * Whether engines.node allows a matrix entry: an exact version it satisfies, or a major
 * (or major.minor) any of whose versions it allows.
 */
function allowsNodeVersion(nodeEngines: string, value: unknown) {
  const version = String(value);
  if (semver.valid(version)) {
    return semver.satisfies(version, nodeEngines);
  }

  if (!/^\d+(?:\.(?:\d+|x))?(?:\.x)?$/.test(version)) {
    return true;
  }

  try {
    return semver.intersects(`${version}.x`, nodeEngines);
  } catch {
    return true;
  }
}
