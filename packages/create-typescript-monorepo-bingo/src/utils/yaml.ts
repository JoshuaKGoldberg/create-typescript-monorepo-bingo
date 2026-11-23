import { isDeepStrictEqual } from 'node:util';

import { type Document, isMap, isNode, isScalar, isSeq, parseDocument, stringify } from 'yaml';

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
      changed = syncNodeVersions(document, existing.value, job) || changed;
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
    ? document
        .toString({ flowCollectionPadding: false, lineWidth: 0, singleQuote: true })
        .replaceAll(/[ \t]+$/gm, '')
    : existingText;
}

/**
 * Updates an existing job's `strategy.matrix.node-version` list to CTM's, which follows
 * `engines.node`. Other matrices, and versions written as expressions, are kept.
 */
function syncNodeVersions(document: Document, node: unknown, job: unknown) {
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

  const current = existing.items.map((item) => (isScalar(item) ? item.value : item));
  if (isDeepStrictEqual(current, ours)) {
    return false;
  }

  existing.items = ours.map(
    (version) =>
      existing.items.find((item) => isScalar(item) && item.value === version) ??
      document.createNode(version),
  );
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
  return id.toLowerCase().replaceAll('-', '_');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function keyText(key: unknown) {
  return isScalar(key) ? String(key.value) : String(key);
}
