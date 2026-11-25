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
 * Entries are passed in arrays because Stratum throws on mismatched object values.
 */
export interface CatalogEntry {
  catalog: string;
  dependency: string;
  specifier: string;
}

const namedCatalogsByField: Partial<Record<DependencyField, string>> = {
  dependencies: 'prod',
  devDependencies: 'dev',
  peerDependencies: 'peer',
};

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

function getCatalogSpecifier(catalog: string): string {
  return catalog === 'default' ? 'catalog:' : `catalog:${catalog}`;
}

function getCatalogName(specifier: string): string {
  return specifier.slice('catalog:'.length) || 'default';
}

export interface ResolvedDependencies {
  catalogEntries: CatalogEntry[];
  dependencies: Dependencies;
}

/**
 * `catalogField` is for the build package, whose dependencies are development tools.
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

    dependencies[dependency] = resolveSpecifier(existingSpecifier, specifier, dependency);
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
