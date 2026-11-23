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
        // Existing packages that don't use the build package, like ones with their own
        // tsconfig, would have it as an unused dependency.
        ...((isNew || pkg.usesBuildPackage) && { [getBuildPackageName(options)]: 'workspace:^' }),
        // Existing packages keep their own choice of whether to use Node.js types.
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
      // An empty field, like devDependencies an existing package never had, isn't written.
      if (Object.keys(result.dependencies).length || existingField) {
        resolved[field] = sortKeys(result.dependencies);
      }
    }

    const sharedHomepage = getSharedHomepage(options.packages ?? [], pkg);
    // Where every other library has a homepage of its own, as lint rules may require,
    // a new package gets its directory on GitHub.
    const otherLibraries = (options.packages ?? []).filter(
      (other) => other.kind === 'library' && other.directory !== pkg.directory,
    );
    const homepage =
      sharedHomepage ??
      (otherLibraries.length && otherLibraries.every((other) => other.homepage)
        ? `${getRepositoryUrl(options)}/tree/HEAD/${pkg.directory}#readme`
        : undefined);
    const existingScripts = existing.scripts as Record<string, string> | undefined;
    // A package's own scripts win; a task runner only adds the ones it needs.
    // CTM's Vitest config names projects by folder, or by path where folder names repeat.
    const folder = pkg.directory.split('/').pop() ?? pkg.directory;
    const project = (options.packages ?? []).some(
      (other) => other.directory !== pkg.directory && other.directory.split('/').pop() === folder,
    )
      ? pkg.directory
      : folder;
    // A repository's own Vitest config may not have CTM's per-package projects, so its
    // packages' tests are left to it, as are other test runners'.
    const test =
      options.testRunner === 'other' || options.vitestConfigUnowned
        ? undefined
        : // Packages that run Vitest themselves do so with Vitest's defaults.
          options.packagesRunVitest
          ? 'vitest run'
          : `vitest run --config ${'../'.repeat(pkg.directory.split('/').length)}vitest.config.ts --project ${project}`;
    // Targets a package's nx project.json defines aren't repeated as scripts.
    const targets = new Set(pkg.nxTargets);
    const merged = buildsPerPackage(options)
      ? {
          ...(!targets.has('build') && { build: 'tsdown' }),
          ...(usesTaskRunner(options) && test && !targets.has('test') && { test }),
          ...existingScripts,
        }
      : existingScripts;
    // A test script just as CTM writes it is CTM's: its project name follows the Vitest
    // config's, which changes as packages with the same folder name come and go.
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
          // A homepage every other library shares, like a project website, is shared too.
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
      // An empty scripts object isn't added to a package that had none.
      ...(scripts &&
        (Object.keys(scripts).length || existingScripts) && { scripts: sortKeys(scripts) }),
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

/**
 * Finds the tsdown and vitest devDependencies most other libraries declare themselves,
 * as some repositories' lint rules require, so a new package declares them the same way.
 */
function getSiblingToolDependencies(options: RootOptions, pkg: PackageSpec) {
  const tools = options.testRunner === 'other' ? ['tsdown'] : ['tsdown', 'vitest'];

  return Object.fromEntries(
    tools.flatMap((tool) => {
      // Packages CTM doesn't build, like ones built with tsc, still test like the rest.
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
      // A tsdown older than the one the build package's base is written for can't build it.
      const minimum =
        specifier && semver.validRange(specifier) ? semver.minVersion(specifier) : undefined;
      if (tool === 'tsdown' && minimum && semver.lt(minimum, pin('tsdown'))) {
        return [];
      }

      return [[tool, specifier]];
    }),
  );
}

/**
 * Whether a test script is the one CTM writes for a package, apart from its project name.
 */
function isCTMTestScript(script: string, ours: string) {
  const withoutProject = (text: string) => text.replace(/ --project \S+$/, '');
  return /--project \S+$/.test(script) && withoutProject(script) === withoutProject(ours);
}

/**
 * Finds a homepage that every other library package shares, like a project website.
 * One sibling isn't enough to tell, and a homepage naming a package, like its readme's
 * URL, belongs to that package.
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
  // Compared by whole URL path segments, so a site like bingo.js.org isn't ruled out.
  // A GitHub repository's owner and name, as in its readme's URL, don't name a package.
  const path = homepage.replace(/^https?:\/\/github\.com\/[^/]+\/[^/#?]+/, '');
  const segments = new Set(path.replace(/^\w+:\/\/[^/]*/, '').split(/[/#?]/));
  return names.some((name) => segments.has(name)) ? undefined : homepage;
}
