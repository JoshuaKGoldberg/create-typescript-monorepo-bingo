import { Document, isMap, isNode, isScalar, isSeq, parseDocument } from 'yaml';
import { z } from 'zod';

import { rootBase } from '../../bases/rootBase.ts';
import type { CatalogEntry } from '../../utils/catalogs.ts';
import { readText } from '../../utils/files.ts';
import { mergeList } from '../../utils/lists.ts';
import { largerSpecifier, resolveSpecifier } from '../../utils/versions.ts';

const catalogEntrySchema = z.object({
  catalog: z.string(),
  dependency: z.string(),
  specifier: z.string(),
});

/**
 * Owns `pnpm-workspace.yaml`: package globs, catalogs, build permissions and settings.
 * Unknown keys and comments in an existing file are kept.
 */
export const blockPnpmWorkspace = rootBase.createBlock({
  about: {
    name: 'pnpm Workspace',
  },
  intake({ files }) {
    const existing = readText(files, 'pnpm-workspace.yaml');
    return existing === undefined ? undefined : { existing };
  },
  props: {
    catalogEntries: z.array(catalogEntrySchema).optional(),
    existing: z.string().optional(),
    packages: z.array(z.string()).optional(),
    settings: z.record(z.string(), z.unknown()).optional(),
  },
  produce({ options, props }) {
    const document = props.existing ? parseDocument(props.existing) : new Document({});
    if (!isMap(document.contents)) {
      document.contents = document.createNode({});
    }

    // Maps that were sorted (or are new) stay sorted; hand-ordered ones keep their order.
    const unsortedMaps = new WeakSet();
    collectUnsortedMaps(document.contents, unsortedMaps);

    // Package globs: keep what's there, adding any new ones.
    const existingGlobs = readStrings(document.get('packages'));
    const globs = mergeList(existingGlobs.length ? existingGlobs : undefined, [
      ...(existingGlobs.length ? [] : ['packages/*']),
      // Package directories that no existing glob covers, like a new packages/build.
      ...(props.packages ?? []).filter(
        (directory) => !existingGlobs.some((glob) => globCovers(glob, directory)),
      ),
    ]);
    if (globs.length !== existingGlobs.length) {
      document.set('packages', document.createNode(globs));
    }

    for (const [key, value] of Object.entries(props.settings ?? {})) {
      setDeep(document, [key], value);
    }

    // The default catalog is written wherever it already is: catalog, or catalogs.default.
    const defaultPath =
      document.has('catalog') || !document.hasIn(['catalogs', 'default'])
        ? ['catalog']
        : ['catalogs', 'default'];

    for (const { catalog, dependency, specifier } of resolveCatalogEntries(
      readCatalogEntries(document),
      props.catalogEntries ?? [],
    )) {
      document.setIn(
        catalog === 'default' ? [...defaultPath, dependency] : ['catalogs', catalog, dependency],
        specifier,
      );
    }

    sortMaps(document.contents, unsortedMaps);
    spaceTopLevel(document);

    return {
      suggestions: (options.catalogExcluded ?? []).map(
        (excluded) =>
          `${excluded.replace(':', ' catalog: ')} has different versions across packages, so it's left out of catalogs. Align them to catalog it.`,
      ),
      files: {
        'pnpm-workspace.yaml': document.toString({ singleQuote: true }),
      },
    };
  },
});

/**
 * Resolves forwarded catalog entries against the ones already on disk.
 * Forwarded entries for one dependency fold to the largest; the result then
 * replaces the disk entry only if it's newer or a different alias target.
 * Disk entries nobody forwarded are kept.
 */
export function resolveCatalogEntries(
  intake: CatalogEntry[],
  forwarded: CatalogEntry[],
): CatalogEntry[] {
  const keyOf = (entry: CatalogEntry) => `${entry.catalog}\0${entry.dependency}`;
  const combined = new Map<string, CatalogEntry>();

  for (const entry of forwarded) {
    const key = keyOf(entry);
    const previous = combined.get(key);
    combined.set(
      key,
      previous
        ? {
            ...entry,
            specifier: largerSpecifier(previous.specifier, entry.specifier, entry.dependency),
          }
        : entry,
    );
  }

  const result = new Map(intake.map((entry) => [keyOf(entry), entry]));

  for (const [key, entry] of combined) {
    const existing = result.get(key);
    result.set(key, {
      ...entry,
      specifier: resolveSpecifier(existing?.specifier, entry.specifier, entry.dependency),
    });
  }

  return [...result.values()];
}

function readCatalogEntries(document: Document): CatalogEntry[] {
  const entries: CatalogEntry[] = [];

  const readCatalog = (catalog: string, node: unknown) => {
    if (!isMap(node)) {
      return;
    }

    for (const pair of node.items) {
      if (isScalar(pair.key) && isScalar(pair.value)) {
        entries.push({
          catalog,
          dependency: String(pair.key.value),
          specifier: String(pair.value.value),
        });
      }
    }
  };

  readCatalog('default', document.get('catalog'));

  const catalogs = document.get('catalogs');
  if (isMap(catalogs)) {
    for (const pair of catalogs.items) {
      if (isScalar(pair.key)) {
        readCatalog(String(pair.key.value), pair.value);
      }
    }
  }

  return entries;
}

function readStrings(node: unknown): string[] {
  return isSeq(node)
    ? node.items.flatMap((item) => (isScalar(item) ? [String(item.value)] : []))
    : [];
}

function setDeep(document: Document, path: string[], value: unknown) {
  if (Array.isArray(value)) {
    // Lists like publicHoistPattern keep their existing entries.
    const existing = readStrings(document.getIn(path));
    if (value.every((item) => existing.includes(item as string)) && existing.length) {
      return;
    }
    document.setIn(
      path,
      document.createNode(mergeList(existing.length ? existing : undefined, value as string[])),
    );
    return;
  }

  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      setDeep(document, [...path, key], child);
    }
  } else {
    document.setIn(path, value);
  }
}

function collectUnsortedMaps(node: unknown, unsorted: WeakSet<object>) {
  if (isMap(node)) {
    const keys = node.items.map((pair) => keyText(pair.key));
    if (keys.some((key, index) => index > 0 && compareKeys(keys[index - 1] ?? '', key) > 0)) {
      unsorted.add(node);
    }
    for (const pair of node.items) {
      collectUnsortedMaps(pair.value, unsorted);
    }
  } else if (isSeq(node)) {
    for (const item of node.items) {
      collectUnsortedMaps(item, unsorted);
    }
  }
}

function sortMaps(node: unknown, unsorted: WeakSet<object>) {
  if (isMap(node)) {
    if (!unsorted.has(node)) {
      node.items.sort((a, b) => compareKeys(keyText(a.key), keyText(b.key)));
    }
    for (const pair of node.items) {
      sortMaps(pair.value, unsorted);
    }
  } else if (isSeq(node)) {
    for (const item of node.items) {
      sortMaps(item, unsorted);
    }
  }
}

/**
 * If top-level keys are separated by blank lines, keeps new ones separated too.
 */
function spaceTopLevel(document: Document) {
  const node = document.contents;
  if (!isMap(node)) {
    return;
  }

  const pairs = node.items.slice(1);
  if (!pairs.some((pair) => isNode(pair.key) && pair.key.spaceBefore)) {
    return;
  }

  for (const pair of pairs) {
    const key = isNode(pair.key) ? pair.key : document.createNode(pair.key);
    key.spaceBefore = true;
    pair.key = key;
  }

  const first = node.items[0]?.key;
  if (isNode(first)) {
    first.spaceBefore = false;
  }
}

function keyText(key: unknown) {
  return isScalar(key) ? String(key.value) : String(key);
}

function compareKeys(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function globCovers(glob: string, directory: string) {
  const normalized = glob.replace(/^\.\//, '').replace(/\/$/, '');
  if (normalized === directory) {
    return true;
  }

  if (normalized.endsWith('/**')) {
    return directory.startsWith(normalized.slice(0, -2));
  }

  return (
    normalized.endsWith('/*') &&
    directory.startsWith(normalized.slice(0, -1)) &&
    !directory.slice(normalized.length - 1).includes('/')
  );
}
