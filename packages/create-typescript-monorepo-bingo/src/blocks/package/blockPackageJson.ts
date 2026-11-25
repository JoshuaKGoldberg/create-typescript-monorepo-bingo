import semver from 'semver';
import { z } from 'zod';

import { packageBase } from '../../bases/packageBase.ts';
import { defaults, type PackageSpec, type RootOptions } from '../../options.ts';
import { asPackageExtension } from '../../production/asRootExtension.ts';
import {
  type CatalogEntry,
  type Dependencies,
  type DependencyField,
  dependencyFields,
  resolveDependencies,
} from '../../utils/catalogs.ts';
import { parseJsonText, readText } from '../../utils/files.ts';
import { formatPackageJson, mergeScripts, sortKeys } from '../../utils/json.ts';
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
        // Existing packages might not use the build package, which Knip would report as unused
        ...((isNew || pkg.usesBuildPackage) && { [getBuildPackageName(options)]: 'workspace:^' }),
        ...(isNew && { '@types/node': pin('@types/node') }),
        ...(isNew && getSiblingToolDependencies(options, pkg)),
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
      if (Object.keys(result.dependencies).length || existingField) {
        resolved[field] = sortKeys(result.dependencies);
      }
    }

    const sharedHomepage = getSharedHomepage(options.packages ?? [], pkg);
    // If other libraries all have their own homepages, lint rules may require one
    const otherLibraries = (options.packages ?? []).filter(
      (other) => other.kind === 'library' && other.directory !== pkg.directory,
    );
    const homepage =
      sharedHomepage ??
      (otherLibraries.length && otherLibraries.every((other) => other.homepage)
        ? `${getRepositoryUrl(options)}/tree/HEAD/${pkg.directory}#readme`
        : undefined);
    const existingScripts = existing.scripts as Record<string, string> | undefined;
    // CTM's Vitest config names projects by folder, or by path if folder names repeat
    const folder = pkg.directory.split('/').pop() ?? pkg.directory;
    const project = (options.packages ?? []).some(
      (other) => other.directory !== pkg.directory && other.directory.split('/').pop() === folder,
    )
      ? pkg.directory
      : folder;
    // A repository's own Vitest config may not have per-package projects
    const test =
      options.testRunner === 'other' || options.vitestConfigUnowned
        ? undefined
        : `vitest run --config ${'../'.repeat(pkg.directory.split('/').length)}vitest.config.ts --project ${project}`;
    const targets = new Set(pkg.nxTargets);
    const merged = buildsPerPackage(options)
      ? mergeScripts(existingScripts, {
          ...(!targets.has('build') && { build: 'tsdown' }),
          ...(usesTaskRunner(options) && test && !targets.has('test') && { test }),
        })
      : existingScripts;
    // CTM's project names change as packages with the same folder name come and go
    const scripts =
      test && merged?.test !== undefined && isCTMTestScript(merged.test, test)
        ? { ...merged, test }
        : merged;

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
          ...(homepage && { homepage }),
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
      ...(scripts && (Object.keys(scripts).length || existingScripts) && { scripts }),
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

function toRepositoryObject(repository: unknown, fallbackUrl: string): Record<string, unknown> {
  if (typeof repository === 'string') {
    return { type: 'git', url: repository };
  }

  return repository && typeof repository === 'object'
    ? (repository as Record<string, unknown>)
    : { type: 'git', url: fallbackUrl };
}

/**
 * Finds tools most other libraries declare, as some repositories' lint rules require.
 */
function getSiblingToolDependencies(options: RootOptions, pkg: PackageSpec) {
  const tools = options.testRunner === 'other' ? ['tsdown'] : ['tsdown', 'vitest'];

  return Object.fromEntries(
    tools.flatMap((tool) => {
      // Packages that aren't built with tsdown may still use Vitest
      const kinds = tool === 'vitest' ? ['library', 'repo-owned'] : ['library'];
      const others = (options.packages ?? []).filter(
        (other) => kinds.includes(other.kind) && other.directory !== pkg.directory,
      );
      const specifiers = others.flatMap((other) => other.toolDevDependencies?.[tool] ?? []);
      if (specifiers.length * 2 <= others.length) {
        return [];
      }

      const counts = new Map<string, number>();
      for (const specifier of specifiers) {
        counts.set(specifier, (counts.get(specifier) ?? 0) + 1);
      }
      const specifier = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? specifiers[0];
      // The build package's base needs at least CTM's tsdown version
      const minimum =
        specifier && semver.validRange(specifier) ? semver.minVersion(specifier) : undefined;
      if (tool === 'tsdown' && minimum && semver.lt(minimum, pin('tsdown'))) {
        return [];
      }

      return [[tool, specifier]];
    }),
  );
}

function isCTMTestScript(script: string, ours: string) {
  const withoutProject = (text: string) => text.replace(/ --project \S+$/, '');
  return /--project \S+$/.test(script) && withoutProject(script) === withoutProject(ours);
}

/**
 * Finds a homepage shared by all other libraries, such as a project website.
 */
function getSharedHomepage(packages: PackageSpec[], pkg: PackageSpec) {
  const others = packages.filter(
    (other) => other.kind === 'library' && other.directory !== pkg.directory,
  );
  const [homepage, ...rest] = new Set(others.map((other) => other.homepage));
  if (others.length < 2 || rest.length || !homepage) {
    return undefined;
  }

  const names = others.flatMap((other) => [
    other.directory.split('/').pop() ?? other.directory,
    other.name.split('/').pop() ?? other.name,
  ]);
  // A GitHub repository's name shouldn't count as a package's
  const path = homepage.replace(/^https?:\/\/github\.com\/[^/]+\/[^/#?]+/, '');
  // Whole segments are compared so that sites such as bingo.js.org aren't ruled out
  const segments = new Set(path.replace(/^\w+:\/\/[^/]*/, '').split(/[/#?]/));
  return names.some((name) => segments.has(name)) ? undefined : homepage;
}
