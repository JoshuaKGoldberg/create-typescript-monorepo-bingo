import semver from 'semver';
import { type Document, isMap, isNode, isScalar, isSeq, parseDocument, stringify } from 'yaml';

import { annotateActionVersions } from './actions.ts';
import { sortKeysDeep } from './json.ts';

export function formatYaml(value: unknown): string {
  return annotateActionVersions(stringify(value, { lineWidth: 0, singleQuote: true }));
}

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
 * Existing workflows only receive missing jobs and updated Node.js version matrices.
 * Other existing files are kept as they are.
 * @throws If an existing file can't be parsed.
 */
export function formatYamlFile(
  value: unknown,
  existingText: string | undefined,
  {
    name,
    nodeEngines,
    scripts = {},
    sorted = false,
    workflow = false,
  }: {
    name?: string;
    nodeEngines?: string;
    scripts?: Record<string, string>;
    sorted?: boolean;
    workflow?: boolean;
  } = {},
): string {
  if (sorted) {
    value = sortKeysDeep(value);
  }

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

  for (const [id, job] of sortByNeeds(value.jobs)) {
    const existing = jobs.items.find(
      (pair) => normalizeJobId(keyText(pair.key)) === normalizeJobId(id),
    );

    if (existing) {
      changed = syncNodeVersions(document, existing.value, job, nodeEngines) || changed;
      continue;
    }

    // Equivalent jobs may have different ids
    const currentJobs = getPath(document.toJS() as Record<string, unknown>, ['jobs']);
    const existingJobs = isPlainObject(currentJobs) ? currentJobs : {};
    if (hasEquivalentJob(existingJobs, job, scripts) || !hasNeeds(existingJobs, job)) {
      continue;
    }

    const created = document.createPair(id, job);
    const index = sorted ? jobs.items.findIndex((pair) => keyText(pair.key) > id) : -1;
    const next = jobs.items.at(index);
    if (index === 0 && next && isNode(next.key) && jobs.commentBefore) {
      next.key.commentBefore = jobs.commentBefore;
      jobs.commentBefore = undefined;
    }
    jobs.items.splice(index === -1 ? jobs.items.length : index, 0, created);
    if (spaced && isNode(created.key)) {
      created.key.spaceBefore = index !== 0;
      if (index === 0 && next && isNode(next.key)) {
        next.key.spaceBefore = true;
      }
    }
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
 * Other matrices, and versions written as expressions, are kept.
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

  const kept = existing.items.filter(
    (item) =>
      !isScalar(item) || nodeEngines === undefined || allowsNodeVersion(nodeEngines, item.value),
  );
  const values = new Set(kept.map((item) => (isScalar(item) ? String(item.value) : item)));
  const added = ours.filter((version) => !values.has(String(version)));

  if (kept.length === existing.items.length && !added.length) {
    return false;
  }

  // Sorted lists should stay sorted
  const items = [...kept];
  for (const version of added) {
    const target = semver.coerce(String(version));
    // CTM writes minimum versions before their majors
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

function sortByNeeds(jobs: Record<string, unknown>) {
  const depth = (id: string): number => {
    const job = jobs[id];
    const needs = (isPlainObject(job) ? [job.needs ?? []].flat() : []) as string[];
    return Math.max(0, ...needs.map((need) => depth(need) + 1));
  };
  return Object.entries(jobs).sort(([a], [b]) => depth(a) - depth(b));
}

/**
 * Existing jobs might not have the ids or outputs that CTM's versions of them do.
 */
function hasNeeds(jobs: Record<string, unknown>, job: unknown) {
  const needs = (isPlainObject(job) ? [job.needs ?? []].flat() : []) as string[];
  const outputs = JSON.stringify(job).matchAll(/\bneeds\.(\w+)\.outputs(?:\.|\[')([\w-]+)/g);
  return (
    needs.every((id) => getPath(jobs, [id]) !== undefined) &&
    [...outputs].every(
      ([, id = '', output = '']) => getPath(jobs, [id, 'outputs', output]) !== undefined,
    )
  );
}

function hasEquivalentJob(
  existingJobs: Record<string, unknown>,
  job: unknown,
  scripts: Record<string, string>,
) {
  const ours = getSteps(job);
  const actions = ours.flatMap((step) => (step.uses ? [normalizeUses(step.uses)] : []));
  const distinctive = actions.filter(
    (uses) =>
      !uses.startsWith('$/') &&
      !uses.startsWith('./') &&
      uses !== 'actions/checkout' &&
      uses !== 'actions/create-github-app-token',
  );
  const runs = ours.flatMap((step) => (step.run ? [normalizeRun(step.run, scripts)] : []));

  return Object.values(existingJobs).some((existingJob) => {
    const steps = getSteps(existingJob);
    const existingActions = new Set(
      steps.flatMap((step) => (step.uses ? [normalizeUses(step.uses)] : [])),
    );
    const existingRuns = new Set(
      steps.flatMap((step) =>
        step.run
          ? expandMatrix(step.run, existingJob).map((run) => normalizeRun(run, scripts))
          : [],
      ),
    );
    return (
      (distinctive.length > 0 && distinctive.every((uses) => existingActions.has(uses))) ||
      (runs.length > 0 && runs.every((run) => existingRuns.has(run))) ||
      // Tests that need other steps first, such as a build, would fail in CTM's job
      (runs.length > 0 &&
        hasPreparation(steps, scripts) &&
        runs.every(
          (run) =>
            run.startsWith('vitest') &&
            [...existingRuns].some(
              (existing) => withoutVitestArgs(existing) === withoutVitestArgs(run),
            ),
        ))
    );
  });
}

/**
 * A `pnpm ${{ matrix.task }}` with a task matrix counts as running each of the tasks.
 */
function expandMatrix(run: string, job: unknown): string[] {
  const strategy = isPlainObject(job) && isPlainObject(job.strategy) ? job.strategy : {};
  const matrix = isPlainObject(strategy.matrix) ? strategy.matrix : {};
  const match = /\$\{\{\s*matrix\.([\w-]+)\s*\}\}/.exec(run);
  const values = match?.[1] === undefined ? undefined : matrix[match[1]];
  if (!match || !Array.isArray(values)) {
    return [run];
  }

  return values
    .filter((value) => typeof value === 'string' || typeof value === 'number')
    .flatMap((value) => expandMatrix(run.replace(match[0], String(value)), job));
}

function getSteps(job: unknown): { run?: string; uses?: string }[] {
  return isPlainObject(job) && Array.isArray(job.steps) ? flattenSteps(job.steps) : [];
}

/**
 * Steps may be nested in groups such as `parallel:`.
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
 * Expands pnpm scripts so that equivalent commands compare equal.
 */
function normalizeRun(run: string, scripts: Record<string, string>): string {
  const command = run
    .trim()
    .replace(/^(?:pnpm (?:run |exec )?|npx )/, '')
    // Filters with dependencies, such as --filter=site..., run the same package's script
    .replaceAll(/(--filter[= ]\S+?)\.\.\.(?=\s|$)/g, '$1');
  const [name = '', ...args] = command.split(/\s+/);
  const script = scripts[name];
  return script && script !== command
    ? normalizeRun([script, ...args].join(' '), {})
    : normalizePrettier(command.replaceAll(/\s+/g, ' '));
}

function normalizePrettier(command: string) {
  const [name = '', ...args] = command.split(' ');
  return /^prettier(?:@|$)/.test(name)
    ? [
        'prettier',
        ...args
          .filter((arg) => !/^(?:-u|--ignore-unknown)$/.test(arg))
          .map((arg) => (/^(?:-c|-l|--list-different)$/.test(arg) ? '--check' : arg))
          .sort(),
      ].join(' ')
    : command;
}

/**
 * Whether a job runs anything other than installs before its tests.
 */
function hasPreparation(steps: { run?: string }[], scripts: Record<string, string>) {
  const runs = steps.flatMap((step) => (step.run ? [normalizeRun(step.run, scripts)] : []));
  const test = runs.findIndex((run) => run.startsWith('vitest'));
  return runs
    .slice(0, test)
    .some((run) => !/^(?:(?:pnpm )?(?:i|install)(?: -\S+)*|corepack [^&;|]*)$/.test(run));
}

function withoutVitestArgs(command: string) {
  return command
    .replaceAll(/\$\{\{.*?\}\}/g, '')
    .replaceAll(/ (?:run|--run|--coverage)(?= |$)/g, '')
    .trim();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function keyText(key: unknown) {
  return isScalar(key) ? String(key.value) : String(key);
}

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
