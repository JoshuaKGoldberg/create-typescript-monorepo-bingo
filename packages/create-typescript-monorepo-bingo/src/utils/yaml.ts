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
  { workflow = false }: { workflow?: boolean } = {},
): string {
  if (existingText === undefined) {
    return workflow ? formatWorkflow(value) : formatYaml(value);
  }

  const document = parseDocument(existingText);
  const merged = workflow ? withExistingJobs(value, document.toJS()) : value;
  document.contents = mergeNode(document, document.contents, merged) as typeof document.contents;

  return document.toString({ lineWidth: 0, singleQuote: true }).replaceAll(/[ \t]+$/gm, '');
}

/**
 * Keeps jobs in an existing workflow that CTM doesn't produce, such as hand-written ones.
 */
function withExistingJobs(value: unknown, existing: unknown): unknown {
  if (!isPlainObject(value) || !isPlainObject(existing) || !isPlainObject(existing.jobs)) {
    return value;
  }

  const jobs = isPlainObject(value.jobs) ? value.jobs : {};
  return {
    ...value,
    jobs: { ...jobs, ...omitKeys(existing.jobs, Object.keys(jobs)) },
  };
}

function omitKeys(value: Record<string, unknown>, keys: string[]) {
  const omitted = new Set(keys);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !omitted.has(key)));
}

function mergeNode(document: Document, node: unknown, value: unknown): unknown {
  if (isPlainObject(value)) {
    if (!isMap(node)) {
      return document.createNode(value);
    }

    const sorted = isSortedMap(node);
    const spaced = node.items.slice(1).some((pair) => isNode(pair.key) && pair.key.spaceBefore);

    const keys = new Set(Object.keys(value));
    node.items = node.items.filter((pair) => keys.has(keyText(pair.key)));

    for (const [key, child] of Object.entries(value)) {
      const pair = node.items.find((item) => keyText(item.key) === key);
      if (pair) {
        pair.value = mergeNode(document, pair.value, child);
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

    node.items = value.map((item, index) =>
      index < node.items.length
        ? mergeNode(document, node.items[index], item)
        : document.createNode(item),
    );

    return node;
  }

  if (isScalar(node) && (value === null || typeof value !== 'object')) {
    if (node.value !== value) {
      node.value = value;
    }

    return node;
  }

  return document.createNode(value);
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
