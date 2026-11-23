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

    const existingScripts = existing.scripts as Record<string, string> | undefined;
    const scripts = usesTaskRunner(options)
      ? {
          ...existingScripts,
          build: 'tsdown',
          test: `vitest run --config ${'../'.repeat(pkg.directory.split('/').length)}${options.vitestConfig ?? 'vitest.config.ts'} --project ${pkg.directory.split('/').pop() ?? pkg.name}`,
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
      engines: {
        ...(base.engines as object | undefined),
        node: options.nodeEngines ?? defaults.nodeEngines,
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
