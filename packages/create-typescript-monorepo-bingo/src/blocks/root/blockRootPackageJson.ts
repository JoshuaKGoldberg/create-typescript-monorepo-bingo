import semver from 'semver';
import { z } from 'zod';

import { rootBase } from '../../bases/rootBase.ts';
import { defaults } from '../../options.ts';
import { type Dependencies, resolveDependencies } from '../../utils/catalogs.ts';
import { parseJsonText, readText } from '../../utils/files.ts';
import { formatPackageJson, sortKeys } from '../../utils/json.ts';
import { getAuthor, getRepositoryUrl } from '../../utils/options.ts';
import { blockPnpmWorkspace } from './blockPnpmWorkspace.ts';

const dependenciesSchema = z.record(z.string(), z.string());

/**
 * Owns the root, private `package.json`: scripts, devDependencies and tool settings.
 * Keys and scripts it doesn't know about are kept from the existing file.
 */
export const blockRootPackageJson = rootBase.createBlock({
  about: {
    name: 'Root package.json',
  },
  intake({ files }) {
    const existing = readText(files, 'package.json');
    return existing === undefined ? undefined : { existing };
  },
  props: {
    devDependencies: dependenciesSchema.optional(),
    existing: z.string().optional(),
    properties: z.record(z.string(), z.unknown()).optional(),
    removedDevDependencies: z.array(z.string()).optional(),
    scripts: z.record(z.string(), z.string()).optional(),
  },
  produce({ options, props }) {
    const existing = parseJsonText(props.existing);
    const existingDevDependencies = { ...(existing.devDependencies as Dependencies | undefined) };
    for (const removed of props.removedDevDependencies ?? []) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete existingDevDependencies[removed];
    }

    const { catalogEntries, dependencies: resolved } = resolveDependencies(
      // Root-only devDependencies aren't cataloged in default mode: they're declared once.
      options,
      'devDependencies',
      existingDevDependencies,
      props.devDependencies,
    );
    const dependencies = alignCompanions(existingDevDependencies, resolved);

    const packageJson = {
      ...(props.existing === undefined
        ? {
            name: `${options.repository}-monorepo`,
            version: '0.0.0',
            description: options.description,
            repository: { type: 'git', url: getRepositoryUrl(options) },
            license: 'MIT',
            author: getAuthor(options),
            type: 'module',
          }
        : existing),
      private: true,
      // Tool settings, like lint-staged and simple-git-hooks, only fill in what's missing.
      ...deepWithDefaults(existing, props.properties ?? {}),
      // Existing scripts keep their order; a new file's are sorted.
      scripts: (props.existing === undefined ? sortKeys : (value: Record<string, string>) => value)(
        mergeScripts(existing.scripts as Record<string, string>, props.scripts),
      ),
      devDependencies: sortKeys(dependencies),
      // devEngines.packageManager is the newer way to say the same thing.
      ...(!(existing.devEngines as { packageManager?: unknown } | undefined)?.packageManager && {
        packageManager: getPackageManager(existing.packageManager, options.pnpm ?? defaults.pnpm),
      }),
      engines: {
        ...(existing.engines as object | undefined),
        node: options.nodeEngines ?? defaults.nodeEngines,
      },
    };

    return {
      extensions: catalogEntries.length ? [blockPnpmWorkspace({ catalogEntries })] : [],
      files: {
        'package.json': formatPackageJson(packageJson, props.existing),
      },
    };
  },
  setup() {
    return {
      scripts: [{ commands: ['pnpm install'], phase: 0 }],
    };
  },
  transition() {
    // Dependencies CTM adds can leave duplicates that pnpm dedupe --check would fail on.
    return {
      scripts: [{ commands: ['pnpm install', 'pnpm dedupe'], phase: 0 }],
    };
  },
});

/**
 * Adds CTM's scripts that the repository doesn't have yet.
 */
function mergeScripts(
  existing: Record<string, string> | undefined,
  ours: Record<string, string> | undefined,
): Record<string, string> {
  const merged = { ...existing };

  // Scripts the repository already has are its own, such as builds with extra flags.
  for (const [name, command] of Object.entries(ours ?? {})) {
    merged[name] ??= command;
  }

  return merged;
}

/**
 * Gets the packageManager value. An existing pnpm at least as new as the one asked for is
 * kept exactly, including any integrity hash.
 */
function getPackageManager(existing: unknown, version: string) {
  if (typeof existing === 'string' && existing.startsWith('pnpm@')) {
    const existingVersion = existing.slice('pnpm@'.length).split('+')[0] ?? '';
    if (
      semver.valid(existingVersion) &&
      semver.valid(version) &&
      semver.gte(existingVersion, version)
    ) {
      return existing;
    }
  }

  return `pnpm@${version}`;
}

function deepWithDefaults(
  existing: Record<string, unknown>,
  defaults: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(defaults).map(([key, value]) => {
      const current = existing[key];
      if (current === undefined) {
        return [key, value];
      }

      return [key, isObject(current) && isObject(value) ? { ...value, ...current } : current];
    }),
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Packages released together with another, which must match its version.
 */
const companions: Record<string, string> = {
  '@eslint/js': 'eslint',
  '@vitest/coverage-v8': 'vitest',
};

/**
 * When CTM adds a companion package, like `@vitest/coverage-v8`, next to a core package the
 * repository already has, like vitest, it gets the core package's version rather than CTM's.
 */
function alignCompanions(existing: Dependencies, resolved: Dependencies): Dependencies {
  const aligned = { ...resolved };
  for (const [companion, core] of Object.entries(companions)) {
    const coreSpecifier = existing[core];
    if (
      companion in aligned &&
      !(companion in existing) &&
      coreSpecifier &&
      !coreSpecifier.startsWith('catalog:')
    ) {
      aligned[companion] = coreSpecifier;
    }
  }
  return aligned;
}
