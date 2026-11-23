import { Document, isMap, isScalar, isSeq, parseDocument, type YAMLMap } from 'yaml';
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
  produce({ props }) {
    const document = props.existing ? parseDocument(props.existing) : new Document({});
    if (!isMap(document.contents)) {
      document.contents = document.createNode({}) as YAMLMap;
    }

    // Package globs: keep what's there, adding any new ones.
    const existingGlobs = readStrings(document.get('packages'));
    const globs = mergeList(existingGlobs.length ? existingGlobs : undefined, [
      ...(existingGlobs.length ? [] : ['packages/*']),
      ...(props.packages ?? []),
    ]);
    if (globs.length !== existingGlobs.length) {
      document.set('packages', document.createNode(globs));
    }

    for (const [key, value] of Object.entries(props.settings ?? {})) {
      setDeep(document, [key], value);
    }

    for (const { catalog, dependency, specifier } of resolveCatalogEntries(
      readCatalogEntries(document),
      props.catalogEntries ?? [],
    )) {
      document.setIn(
        catalog === 'default' ? ['catalog', dependency] : ['catalogs', catalog, dependency],
        specifier,
      );
    }

    sortMaps(document.contents);

    return {
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
        ? { ...entry, specifier: largerSpecifier(previous.specifier, entry.specifier) }
        : entry,
    );
  }

  const result = new Map(intake.map((entry) => [keyOf(entry), entry]));

  for (const [key, entry] of combined) {
    const existing = result.get(key);
    result.set(key, {
      ...entry,
      specifier: resolveSpecifier(existing?.specifier, entry.specifier),
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
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      setDeep(document, [...path, key], child);
    }
  } else {
    document.setIn(path, value);
  }
}

function sortMaps(node: unknown) {
  if (isMap(node)) {
    node.items.sort((a, b) => compareKeys(keyText(a.key), keyText(b.key)));
    for (const pair of node.items) {
      sortMaps(pair.value);
    }
  } else if (isSeq(node)) {
    for (const item of node.items) {
      sortMaps(item);
    }
  }
}

function keyText(key: unknown) {
  return isScalar(key) ? String(key.value) : String(key);
}

function compareKeys(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}
