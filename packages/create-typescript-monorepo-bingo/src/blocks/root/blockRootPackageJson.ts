import semver from 'semver';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

import { rootBase } from '../../bases/rootBase.ts';
import { defaults } from '../../options.ts';
import { findExplicitChoices } from '../../prepare/prepareRoot.ts';
import { type Dependencies, resolveDependencies } from '../../utils/catalogs.ts';
import { choicesKey, getOtherChoices, isChoicesObject } from '../../utils/choices.ts';
import { parseJsonText, readText } from '../../utils/files.ts';
import { formatPackageJson, mergeScripts, sortKeys } from '../../utils/json.ts';
import { getAuthor, getRepositoryUrl } from '../../utils/options.ts';
import { pin } from '../../utils/pins.ts';
import { getMinimumVersion } from '../../utils/versions.ts';
import { blockPnpmWorkspace } from './blockPnpmWorkspace.ts';

const dependenciesSchema = z.record(z.string(), z.string());

export const blockRootPackageJson = rootBase.createBlock({
  about: {
    name: 'Root package.json',
  },
  intake({ files, options }) {
    const existing = readText(files, 'package.json');
    const workspace = readText(files, 'pnpm-workspace.yaml');
    return {
      choices: findExplicitChoices(files, options),
      ...(existing !== undefined && { existing }),
      ...(workspace !== undefined && { workspace }),
    };
  },
  props: {
    choices: z.record(z.string(), z.string()).optional(),
    devDependencies: dependenciesSchema.optional(),
    existing: z.string().optional(),
    workspace: z.string().optional(),
    properties: z.record(z.string(), z.unknown()).optional(),
    removedDevDependencies: z.array(z.string()).optional(),
    replaced: z.record(z.string(), z.record(z.string(), z.string())).optional(),
    scripts: z.record(z.string(), z.string()).optional(),
  },
  produce({ options, props }) {
    const existing = withReplaced(parseJsonText(props.existing), props.replaced);
    const existingDevDependencies = { ...(existing.devDependencies as Dependencies | undefined) };
    for (const removed of props.removedDevDependencies ?? []) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete existingDevDependencies[removed];
    }

    const { catalogEntries, dependencies: resolved } = resolveDependencies(
      options,
      'devDependencies',
      existingDevDependencies,
      props.devDependencies,
    );
    const dependencies = alignCompanions(existingDevDependencies, resolved, props.workspace);

    const ours = props.choices ?? findExplicitChoices({}, options);
    const existingChoices = existing[choicesKey];
    const ownsChoices = existingChoices === undefined || isChoicesObject(existingChoices);
    const choices = { ...(ownsChoices && getOtherChoices(existingChoices ?? {})), ...ours };
    const hadChoices = isChoicesObject(existingChoices) && !Object.keys(existingChoices).length;

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
      ...(ownsChoices && {
        [choicesKey]: Object.keys(choices).length || hadChoices ? choices : undefined,
      }),
      // Transitions infer the owner and repository from here
      ...(props.existing !== undefined &&
        !existing.repository && {
          repository: { type: 'git', url: getRepositoryUrl(options) },
        }),
      // CTM's package.json lint rules require a description
      ...(props.existing !== undefined &&
        !existing.description &&
        options.description && { description: options.description }),
      ...deepWithDefaults(existing, props.properties ?? {}),
      scripts: (props.existing === undefined ? sortKeys : (value: Record<string, string>) => value)(
        mergeScripts(existing.scripts as Record<string, string> | undefined, props.scripts ?? {}),
      ),
      devDependencies: sortKeys(dependencies),
      ...(!(existing.devEngines as { packageManager?: unknown } | undefined)?.packageManager && {
        packageManager: getPackageManager(existing.packageManager, options.pnpm ?? defaults.pnpm),
      }),
      engines: {
        ...(existing.engines as object | undefined),
        node: options.nodeEngines ?? defaults.nodeEngines,
      },
    };

    return {
      suggestions:
        !ownsChoices && Object.keys(ours).length
          ? [
              `The root package.json's ${choicesKey} isn't an object. Set it to ${JSON.stringify(ours)} for later transitions to use your options.`,
            ]
          : [],
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
    // Added dependencies can leave duplicates that pnpm dedupe --check would fail on
    return {
      scripts: [{ commands: ['pnpm install --no-frozen-lockfile', 'pnpm dedupe'], phase: 0 }],
    };
  },
});

/**
 * Replaces entries that don't work with tooling CTM is adding.
 */
function withReplaced(
  existing: Record<string, unknown>,
  replaced: Record<string, Record<string, string>> = {},
): Record<string, unknown> {
  return {
    ...existing,
    ...Object.fromEntries(
      Object.entries(replaced).map(([key, entries]) => [
        key,
        { ...(existing[key] as object | undefined), ...entries },
      ]),
    ),
  };
}

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
 * Packages that must match the version of another.
 */
const companions: Record<string, string> = {
  '@eslint/js': 'eslint',
  '@vitest/coverage-v8': 'vitest',
};

/**
 * Companions to existing packages should match the repository's version, not CTM's.
 */
function alignCompanions(
  existing: Dependencies,
  resolved: Dependencies,
  workspaceText: string | undefined,
): Dependencies {
  const aligned = { ...resolved };
  for (const [companion, core] of Object.entries(companions)) {
    const coreSpecifier = resolveCatalogReference(existing[core], core, workspaceText);
    if (
      companion in aligned &&
      !(companion in existing) &&
      coreSpecifier &&
      !coreSpecifier.startsWith('catalog:') &&
      // @eslint/js isn't released with every ESLint version
      !(
        companion === '@eslint/js' &&
        getMinimumVersion(core, coreSpecifier, workspaceText)?.major ===
          semver.parse(pin('@eslint/js'))?.major
      )
    ) {
      aligned[companion] = coreSpecifier;
    }
  }
  return aligned;
}

function resolveCatalogReference(
  specifier: string | undefined,
  dependency: string,
  workspaceText: string | undefined,
): string | undefined {
  if (!specifier?.startsWith('catalog:')) {
    return specifier;
  }

  const workspace = (parseYaml(workspaceText ?? '') ?? {}) as {
    catalog?: Record<string, string>;
    catalogs?: Partial<Record<string, Record<string, string>>>;
  };
  const name = specifier.slice('catalog:'.length) || 'default';
  return name === 'default'
    ? (workspace.catalog?.[dependency] ?? workspace.catalogs?.default?.[dependency])
    : workspace.catalogs?.[name]?.[dependency];
}
