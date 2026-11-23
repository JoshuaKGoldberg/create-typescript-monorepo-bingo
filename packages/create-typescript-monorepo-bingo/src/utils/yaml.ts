import { isDeepStrictEqual } from 'node:util';

import {
  type Document,
  isMap,
  isNode,
  isScalar,
  isSeq,
  parseDocument,
  stringify,
  type YAMLMap,
} from 'yaml';

/**
 * Stringifies a value as YAML in the style oxfmt and Prettier use.
 */
export function formatYaml(value: unknown): string {
  return stringify(value, { lineWidth: 0, singleQuote: true });
}

/**
 * Stringifies a GitHub Actions workflow, with blank lines between top-level keys
 * and between jobs, as hand-written workflows usually have.
 */
function formatWorkflow(value: unknown): string {
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
 * Formats a YAML file. A new file is printed fresh (as a workflow, with blank lines,
 * if `workflow` is set); an existing one is updated in place to equal `value`,
 * which keeps its comments, blank lines, quoting and key order.
 */
export function formatYamlFile(
  value: unknown,
  existingText: string | undefined,
  { name, workflow = false }: { name?: string; workflow?: boolean } = {},
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

  const merged = workflow ? withExistingJobs(value, document.toJS()) : value;
  document.contents = mergeNode(document, document.contents, merged) as typeof document.contents;

  const text = document.toString({ lineWidth: 0, singleQuote: true }).replaceAll(/[ \t]+$/gm, '');
  return workflow ? text.replaceAll(/: null$/gm, ': ~') : text;
}

/**
 * Prepares a workflow value for merging into an existing workflow:
 * - workflow-level \`on\`, \`permissions\` and \`concurrency\` that exist are the repository's;
 * - CTM's jobs are matched to existing ones by id (ignoring \`-\` vs \`_\`) or by the
 *   distinctive action they use, and take the existing job's id;
 * - existing jobs CTM doesn't produce are kept.
 */
function withExistingJobs(value: unknown, existing: unknown): unknown {
  if (!isPlainObject(value) || !isPlainObject(existing)) {
    return value;
  }

  const keptKeys = new Set(['concurrency', 'on', 'permissions'].filter((key) => key in existing));
  const result: Record<string, unknown> = Object.fromEntries(
    Object.entries(value).filter(([key]) => !keptKeys.has(key)),
  );

  const existingJobs = isPlainObject(existing.jobs) ? existing.jobs : {};
  const jobs: Record<string, unknown> = {};
  for (const [id, job] of Object.entries(isPlainObject(value.jobs) ? value.jobs : {})) {
    jobs[findExistingJobId(id, job, existingJobs) ?? id] = job;
  }

  if (isPlainObject(value.jobs) || isPlainObject(existing.jobs)) {
    result.jobs = { ...jobs, ...omitKeys(existingJobs, Object.keys(jobs)) };
  }

  return result;
}

function findExistingJobId(
  id: string,
  job: unknown,
  existingJobs: Record<string, unknown>,
): string | undefined {
  const normalized = normalizeJobId(id);
  const byId = Object.keys(existingJobs).find(
    (existingId) => normalizeJobId(existingId) === normalized,
  );
  if (byId) {
    return byId;
  }

  const actions = getDistinctiveActions(job);
  return Object.entries(existingJobs).find(([, existingJob]) =>
    getDistinctiveActions(existingJob).some((action) => actions.includes(action)),
  )?.[0];
}

function normalizeJobId(id: string) {
  return id.toLowerCase().replaceAll('-', '_');
}

function getDistinctiveActions(job: unknown): string[] {
  const steps = isPlainObject(job) && Array.isArray(job.steps) ? job.steps : [];
  return steps
    .map((step) =>
      isPlainObject(step) && typeof step.uses === 'string' ? normalizeUses(step.uses) : '',
    )
    .filter(
      (uses) =>
        uses && !uses.startsWith('$/') && !uses.startsWith('./') && uses !== 'actions/checkout',
    );
}

function omitKeys(value: Record<string, unknown>, keys: string[]) {
  const omitted = new Set(keys);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !omitted.has(key)));
}

function mergeNode(document: Document, node: unknown, value: unknown, key?: string): unknown {
  // An empty value, like a \`pull_request: ~\` trigger, never replaces the repository's settings.
  if (
    value === null &&
    node !== undefined &&
    node !== null &&
    !(isScalar(node) && node.value === null)
  ) {
    return node;
  }

  // A hand-written schedule is the repository's choice.
  if (key === 'schedule' && isSeq(node)) {
    return node;
  }

  if (isPlainObject(value)) {
    // Triggers written as a list, like \`on: [pull_request, push]\`, become a map.
    if (isSeq(node) && node.items.every((item) => isScalar(item))) {
      const names = node.items.map((item) => String((item as { value: unknown }).value));
      node = document.createNode(Object.fromEntries(names.map((name) => [name, null])));
    }

    if (!isMap(node)) {
      return document.createNode(value);
    }

    const sorted = isSortedMap(node);
    const spaced = node.items.slice(1).some((pair) => isNode(pair.key) && pair.key.spaceBefore);

    // Keys CTM doesn't produce are the repository's own, such as a hand-added
    // concurrency group or trigger: they're kept, never removed.

    for (const [key, child] of Object.entries(value)) {
      const pair = node.items.find((item) => keyText(item.key) === key);
      if (pair) {
        pair.value = mergeNode(document, pair.value, child, key);
        continue;
      }

      const created = document.createPair(key, child);
      const index = sorted
        ? node.items.findIndex((item) => keyText(item.key).localeCompare(key) > 0)
        : -1;

      if (spaced && isNode(created.key)) {
        created.key.spaceBefore = true;
      }

      if (index === -1) {
        node.items.push(created);
      } else {
        node.items.splice(index, 0, created);
      }
    }

    // Blank lines separate siblings, so whichever entry ends up first doesn't get one.
    const first = node.items[0]?.key;
    if (spaced && isNode(first)) {
      first.spaceBefore = false;
    }

    return node;
  }

  if (Array.isArray(value)) {
    if (!isSeq(node)) {
      return document.createNode(value);
    }

    // Matrices follow CTM's settings, such as the Node.js versions from engines.node.
    if (key === 'node-version' || key === 'os') {
      node.items = value.map((item) => {
        const same = node.items.find((existing) => isScalar(existing) && existing.value === item);
        return same ?? document.createNode(item);
      });
      return node;
    }

    node.items = mergeSequence(document, node.items, value);

    return node;
  }

  // Existing values are the repository's: CTM only fills in what's missing. Version bumps,
  // like action refs, are Renovate's job.
  if (isScalar(node) && (value === null || typeof value !== 'object')) {
    node.value ??= value;

    return node;
  }

  return document.createNode(value);
}

/**
 * Merges a sequence. Items that are maps, like workflow steps, are matched to existing
 * items by their id, name, action or command, so hand-added items stay where they are.
 * Scalar items are combined: existing ones are kept, and new ones appended.
 */
function mergeSequence(document: Document, existing: unknown[], value: unknown[]): unknown[] {
  if (value.every((item) => !isPlainObject(item) && !Array.isArray(item))) {
    const existingScalars = existing.filter((node) => isScalar(node));
    const known = new Set(existingScalars.map((node) => node.value));
    return [
      ...existing,
      ...value.filter((item) => !known.has(item)).map((item) => document.createNode(item)),
    ];
  }

  const unmatched = [...existing];
  const merged: unknown[] = [];

  for (const item of value) {
    const index = unmatched.findIndex((node) => isSameItem(node, item));
    if (index === -1) {
      // Steps CTM doesn't find in an existing job aren't added: the job is the repository's.
      if (!existing.length) {
        merged.push(document.createNode(item));
      }
      continue;
    }

    // Hand-added items before the match stay where they are.
    merged.push(...unmatched.splice(0, index), mergeNode(document, unmatched.shift(), item));
  }

  return [...merged, ...unmatched];
}

function isSameItem(node: unknown, item: unknown) {
  if (!isMap(node) || !isPlainObject(item)) {
    return false;
  }

  for (const key of ['id', 'name', 'uses', 'run']) {
    const ours = item[key];
    const theirs = node.get(key);
    if (typeof ours === 'string' && typeof theirs === 'string') {
      return key === 'uses'
        ? normalizeUses(ours) === normalizeUses(theirs)
        : key === 'run'
          ? normalizeRun(ours) === normalizeRun(theirs)
          : ours === theirs;
    }
  }

  // Other maps, like schedule entries, match when they're equal.
  return isDeepStrictEqual(node.toJSON(), item);
}

function normalizeUses(uses: string) {
  const at = uses.indexOf('@', 1);
  return (at === -1 ? uses : uses.slice(0, at)).toLowerCase();
}

function normalizeRun(run: string) {
  return run.trim().replace(/^pnpm run /, 'pnpm ');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isSortedMap(node: YAMLMap) {
  const keys = node.items.map((pair) => keyText(pair.key));
  return (
    keys.length > 1 && keys.every((key, index) => index === 0 || (keys[index - 1] ?? '') <= key)
  );
}

function keyText(key: unknown) {
  return isScalar(key) ? String(key.value) : String(key);
}
