import { z } from 'zod';

import { rootBase } from '../../bases/rootBase.ts';
import { parseJsonText, readText } from '../../utils/files.ts';
import { formatJson } from '../../utils/json.ts';
import { getPackageParents } from '../../utils/options.ts';
import { pinned } from '../../utils/pins.ts';
import { blockGitignore } from './blockGitignore.ts';
import { blockPnpmWorkspace } from './blockPnpmWorkspace.ts';
import { blockRootPackageJson } from './blockRootPackageJson.ts';

/**
 * Orchestrates per-package `build` and `test` scripts with pnpm's built-in task graph.
 * Builds run after their workspace dependencies' builds; tests don't wait on anything,
 * because package exports point at source.
 * Only active with `--task-runner pnpm`.
 */
export const blockPnpmTasks = rootBase.createBlock({
  about: {
    name: 'pnpm Tasks',
  },
  produce({ options }) {
    if (options.taskRunner !== 'pnpm') {
      return {};
    }

    const filters = getPackageParents(options)
      .map((parent) => `--filter "./${parent}/*"`)
      .join(' ');

    return {
      extensions: [
        blockPnpmWorkspace({
          settings: { tasks: { test: { dependsOn: [] } } },
        }),
        blockRootPackageJson({
          scripts: {
            build: `pnpm --recursive ${filters} run build`,
            test: `pnpm --recursive ${filters} run test`,
          },
        }),
      ],
    };
  },
});

/**
 * Orchestrates per-package `build` and `test` scripts with Turborepo.
 * Only active with `--task-runner turbo`.
 */
export const blockTurborepo = rootBase.createBlock({
  about: {
    name: 'Turborepo',
  },
  intake({ files }) {
    const existingTurbo = readText(files, 'turbo.json');
    return existingTurbo === undefined ? undefined : { existingTurbo };
  },
  props: {
    existingTurbo: z.string().optional(),
  },
  produce({ options, props }) {
    if (options.taskRunner !== 'turbo') {
      return {};
    }

    return {
      extensions: [
        blockGitignore({ ignores: ['.turbo/'] }),
        blockRootPackageJson({
          devDependencies: pinned('turbo'),
          scripts: {
            build: 'turbo run build',
            test: 'turbo run test',
          },
        }),
      ],
      // An existing turbo.json is the repository's.
      files:
        props.existingTurbo !== undefined
          ? {}
          : {
              'turbo.json': formatJson(
                withExisting(props.existingTurbo, {
                  $schema: 'https://turborepo.com/schema.json',
                  tasks: {
                    build: {
                      dependsOn: ['^build'],
                      // The build package's configs aren't a build dependency turbo can see.
                      inputs: ['$TURBO_DEFAULT$', '$TURBO_ROOT$/packages/build/**'],
                      outputs: ['dist/**', 'lib/**', 'node_modules/.cache/tsbuild/**'],
                    },
                    test: {
                      // Each package's tests run with the root Vitest config.
                      inputs: [
                        '$TURBO_DEFAULT$',
                        `$TURBO_ROOT$/${options.vitestConfig ?? 'vitest.config.ts'}`,
                      ],
                      outputs: [],
                    },
                  },
                }),
                props.existingTurbo,
              ),
            },
    };
  },
});

/**
 * Orchestrates per-package `build` and `test` scripts with Nx, without Nx plugins.
 * Only active with `--task-runner nx`.
 */
export const blockNx = rootBase.createBlock({
  about: {
    name: 'Nx',
  },
  intake({ files }) {
    const existingNx = readText(files, 'nx.json');
    return existingNx === undefined ? undefined : { existingNx };
  },
  props: {
    existingNx: z.string().optional(),
  },
  produce({ options, props }) {
    if (options.taskRunner !== 'nx') {
      return {};
    }

    return {
      extensions: [
        // Nx's own recommendation: other .nx folders, like version plans, are tracked.
        blockGitignore({ ignores: ['.nx/cache/', '.nx/workspace-data/'] }),
        blockPnpmWorkspace({
          settings: { permissions: { nx: { build: false } } },
        }),
        blockRootPackageJson({
          devDependencies: pinned('nx'),
          scripts: {
            build: 'nx run-many --target build',
            test: 'nx run-many --target test',
          },
        }),
      ],
      // An existing nx.json is the repository's, with its own plugins and target defaults.
      files:
        props.existingNx !== undefined
          ? {}
          : {
              'nx.json': formatJson(
                withExisting(props.existingNx, {
                  $schema: './node_modules/nx/schemas/nx-schema.json',
                  namedInputs: {
                    default: ['{projectRoot}/**/*'],
                    production: ['default', '!{projectRoot}/**/*.test.ts'],
                  },
                  targetDefaults: {
                    build: {
                      cache: true,
                      dependsOn: ['^build'],
                      inputs: ['production', '^production', '{workspaceRoot}/packages/build/**/*'],
                      outputs: ['{projectRoot}/dist', '{projectRoot}/lib'],
                    },
                    test: {
                      cache: true,
                      inputs: [
                        'default',
                        '^production',
                        `{workspaceRoot}/${options.vitestConfig ?? 'vitest.config.ts'}`,
                      ],
                    },
                  },
                }),
                props.existingNx,
              ),
            },
    };
  },
});

/**
 * Fills in CTM's settings under an existing config, whose own values always win.
 */
function withExisting(existingText: string | undefined, ours: Record<string, unknown>) {
  return deepMerge(ours, parseJsonText(existingText));
}

function deepMerge(base: Record<string, unknown>, overrides: Record<string, unknown>) {
  const merged: Record<string, unknown> = { ...overrides };
  for (const [key, value] of Object.entries(base)) {
    const override = overrides[key];
    merged[key] =
      override === undefined
        ? value
        : isObject(value) && isObject(override)
          ? deepMerge(value, override)
          : override;
  }
  return merged;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
