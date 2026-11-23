import type { RootOptions } from '../options.ts';
import { isProtocolSpecifier, resolveSpecifier } from './versions.ts';

export const dependencyFields = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const;

export type DependencyField = (typeof dependencyFields)[number];

export type Dependencies = Record<string, string>;

/**
 * One catalog entry, forwarded from wherever a dependency is declared to the
 * pnpm workspace Block. These travel as an array of records, never a
 * `{ dependency: specifier }` map, because Stratum throws on mismatched map values.
 */
export interface CatalogEntry {
  /**
   * Catalog name; `default` for the default catalog.
   */
  catalog: string;
  dependency: string;
  specifier: string;
}

const namedCatalogsByField: Partial<Record<DependencyField, string>> = {
  dependencies: 'prod',
  devDependencies: 'dev',
  peerDependencies: 'peer',
};

/**
 * Gets which catalog a dependency in a field should be written to, if any.
 */
function getCatalogFor(
  options: RootOptions,
  field: DependencyField,
  dependency: string,
): string | undefined {
  switch (options.catalogs) {
    case 'default':
      return field !== 'optionalDependencies' && options.catalogShared?.includes(dependency)
        ? 'default'
        : undefined;

    case 'named': {
      const catalog = namedCatalogsByField[field];
      return catalog && !options.catalogExcluded?.includes(`${catalog}:${dependency}`)
        ? catalog
        : undefined;
    }

    default:
      return undefined;
  }
}

/**
 * Gets the `catalog:` specifier for a catalog name.
 */
function getCatalogSpecifier(catalog: string): string {
  return catalog === 'default' ? 'catalog:' : `catalog:${catalog}`;
}

/**
 * Gets the catalog name a `catalog:` specifier refers to.
 */
function getCatalogName(specifier: string): string {
  return specifier.slice('catalog:'.length) || 'default';
}

export interface ResolvedDependencies {
  catalogEntries: CatalogEntry[];
  dependencies: Dependencies;
}

/**
 * Merges the dependencies CTM wants in a field with what's on disk, applying catalogs.
 * - Existing specifiers are kept unless CTM's pin is newer (see {@link resolveSpecifier}).
 * - Existing `catalog:` specifiers are kept, and CTM's pin is forwarded to the catalog.
 * - In catalog modes, eligible literal specifiers move into their catalog.
 *   `catalogField` overrides which field's catalog that is, for packages like the
 *   build package whose runtime dependencies are really development tools.
 */
export function resolveDependencies(
  options: RootOptions,
  field: DependencyField,
  existing: Dependencies | undefined,
  ours: Dependencies | undefined,
  catalogField: DependencyField = field,
): ResolvedDependencies {
  const catalogEntries: CatalogEntry[] = [];
  const dependencies: Dependencies = { ...existing };

  for (const [dependency, specifier] of Object.entries(ours ?? {})) {
    const existingSpecifier = existing?.[dependency];

    if (existingSpecifier?.startsWith('catalog:')) {
      catalogEntries.push({ catalog: getCatalogName(existingSpecifier), dependency, specifier });
      continue;
    }

    dependencies[dependency] = resolveSpecifier(existingSpecifier, specifier);
  }

  for (const [dependency, specifier] of Object.entries(dependencies)) {
    if (isProtocolSpecifier(specifier)) {
      continue;
    }

    const catalog = getCatalogFor(options, catalogField, dependency);
    if (catalog) {
      catalogEntries.push({ catalog, dependency, specifier });
      dependencies[dependency] = getCatalogSpecifier(catalog);
    }
  }

  return { catalogEntries, dependencies };
}
