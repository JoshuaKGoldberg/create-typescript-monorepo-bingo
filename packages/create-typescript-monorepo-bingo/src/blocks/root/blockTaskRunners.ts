import { rootBase } from '../../bases/rootBase.ts';
import { formatJson } from '../../utils/json.ts';
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

    return {
      extensions: [
        blockPnpmWorkspace({
          settings: { tasks: { test: { dependsOn: [] } } },
        }),
        blockRootPackageJson({
          scripts: {
            build: 'pnpm --recursive --filter "./packages/*" run build',
            test: 'pnpm --recursive --filter "./packages/*" run test',
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
  produce({ options }) {
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
      files: {
        'turbo.json': formatJson({
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
              inputs: ['$TURBO_DEFAULT$', '$TURBO_ROOT$/vitest.config.ts'],
              outputs: [],
            },
          },
        }),
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
  produce({ options }) {
    if (options.taskRunner !== 'nx') {
      return {};
    }

    return {
      extensions: [
        blockGitignore({ ignores: ['.nx/'] }),
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
      files: {
        'nx.json': formatJson({
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
              inputs: ['default', '^production', '{workspaceRoot}/vitest.config.ts'],
            },
          },
        }),
      },
    };
  },
});
