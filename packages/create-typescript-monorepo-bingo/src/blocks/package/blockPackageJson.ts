import { z } from 'zod';

import { packageBase } from '../../bases/packageBase.ts';
import { defaults } from '../../options.ts';
import { asPackageExtension } from '../../production/asRootExtension.ts';
import {
  type CatalogEntry,
  type Dependencies,
  type DependencyField,
  dependencyFields,
  resolveDependencies,
} from '../../utils/catalogs.ts';
import { parseJsonText, readText } from '../../utils/files.ts';
import { formatPackageJson, sortKeys } from '../../utils/json.ts';
import {
  buildsPerPackage,
  getAuthor,
  getBuildPackageName,
  getRepositoryUrl,
  usesTaskRunner,
} from '../../utils/options.ts';
import { pin } from '../../utils/pins.ts';
import { blockPnpmWorkspace } from '../root/blockPnpmWorkspace.ts';

const dependenciesSchema = z.record(z.string(), z.string());

/**
 * Owns a package's `package.json`. New packages get tsdown-shaped `exports` (source)
 * and `publishConfig.exports` (dist); existing ones keep theirs, since tsdown's
 * `devExports` writes them on build. Dependencies follow CTM's version and catalog rules.
 */
export const blockPackageJson = packageBase.createBlock({
  about: {
    name: 'Package package.json',
  },
  intake({ files }) {
    const existing = readText(files, 'package.json');
    return existing === undefined ? undefined : { existing };
  },
  props: {
    dependencies: dependenciesSchema.optional(),
    devDependencies: dependenciesSchema.optional(),
    existing: z.string().optional(),
    peerDependencies: dependenciesSchema.optional(),
  },
  produce({ options, props }) {
    const { package: pkg } = options;
    const existing = parseJsonText(props.existing);
    const isNew = props.existing === undefined;
    const ours: Partial<Record<DependencyField, Dependencies>> = {
      dependencies: props.dependencies,
      devDependencies: {
        [getBuildPackageName(options)]: 'workspace:^',
        // Existing packages keep their own choice of whether to use Node.js types.
        ...(isNew && { '@types/node': pin('@types/node') }),
        ...props.devDependencies,
      },
      peerDependencies: props.peerDependencies,
    };

    const catalogEntries: CatalogEntry[] = [];
    const resolved: Partial<Record<DependencyField, Dependencies>> = {};

    for (const field of dependencyFields) {
      const existingField = existing[field] as Dependencies | undefined;
      if (!existingField && !ours[field]) {
        continue;
      }

      const result = resolveDependencies(options, field, existingField, ours[field]);
      catalogEntries.push(...result.catalogEntries);
      resolved[field] = sortKeys(result.dependencies);
    }

    const homepages = new Set(
      (options.packages ?? [])
        .filter((other) => other.kind === 'library' && other.directory !== pkg.directory)
        .map((other) => other.homepage),
    );
    const [sharedHomepage] = homepages.size === 1 ? [...homepages] : [];
    const existingScripts = existing.scripts as Record<string, string> | undefined;
    // A package's own scripts win; a task runner only adds the ones it needs.
    // A repository's own Vitest config may not have CTM's per-package projects, so its
    // packages' tests are left to it, as are other test runners'.
    const test =
      options.testRunner === 'other'
        ? undefined
        : options.vitestConfigUnowned
          ? undefined
          : `vitest run --config ${'../'.repeat(pkg.directory.split('/').length)}vitest.config.ts --project ${pkg.directory.split('/').pop() ?? pkg.name}`;
    const scripts = buildsPerPackage(options)
      ? {
          build: 'tsdown',
          ...(usesTaskRunner(options) && test && { test }),
          ...existingScripts,
        }
      : existingScripts;

    const base = isNew
      ? {
          version: '0.0.0',
          description: pkg.description,
          repository: {
            type: 'git',
            url: getRepositoryUrl(options),
          },
          license: 'MIT',
          author: getAuthor(options),
          // A homepage every other library shares, like a project website, is shared too.
          ...(sharedHomepage && { homepage: sharedHomepage }),
          sideEffects: false,
          type: 'module',
          exports: {
            '.': './src/index.ts',
            './package.json': './package.json',
          },
          files: ['dist/'],
          publishConfig: {
            exports: {
              '.': './dist/index.mjs',
              './package.json': './package.json',
            },
          },
        }
      : existing;

    const packageJson = {
      ...base,
      name: pkg.name,
      repository: {
        ...toRepositoryObject(base.repository, getRepositoryUrl(options)),
        directory: pkg.directory,
      },
      ...resolved,
      ...(scripts && { scripts: sortKeys(scripts) }),
      // A package's own engines.node is part of what it publishes, so it's kept.
      engines: {
        node: options.nodeEngines ?? defaults.nodeEngines,
        ...(base.engines as object | undefined),
      },
    };

    return {
      extensions: catalogEntries.length
        ? [asPackageExtension(blockPnpmWorkspace({ catalogEntries }))]
        : [],
      files: {
        'package.json': formatPackageJson(packageJson, props.existing),
      },
    };
  },
});

/**
 * Normalizes a package.json `repository`, which may be a string shorthand,
 * to an object that can hold a `directory`.
 */
function toRepositoryObject(repository: unknown, fallbackUrl: string): Record<string, unknown> {
  if (typeof repository === 'string') {
    return { type: 'git', url: repository };
  }

  return repository && typeof repository === 'object'
    ? (repository as Record<string, unknown>)
    : { type: 'git', url: fallbackUrl };
}
