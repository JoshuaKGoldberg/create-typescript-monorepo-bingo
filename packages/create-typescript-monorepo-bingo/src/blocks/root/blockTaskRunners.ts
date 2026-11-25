import type { IntakeDirectory } from 'bingo-fs';
import { z } from 'zod';

import { rootBase } from '../../bases/rootBase.ts';
import { parseJsonText, readText } from '../../utils/files.ts';
import { formatJson } from '../../utils/json.ts';
import { getPackageFilters } from '../../utils/options.ts';
import { pinned } from '../../utils/pins.ts';
import { blockGitignore } from './blockGitignore.ts';
import { blockPnpmWorkspace } from './blockPnpmWorkspace.ts';
import { blockRootPackageJson } from './blockRootPackageJson.ts';

/**
 * Tests don't wait on builds because package exports point at source.
 */
export const blockPnpmTasks = rootBase.createBlock({
  about: {
    name: 'pnpm Tasks',
  },
  intake({ files }) {
    const scripts = parseJsonText(readText(files, 'package.json')).scripts as
      | Record<string, string>
      | undefined;
    return /\bpnpm\b[^&|;]*\s(?:-r|--recursive|-F|--filter)\b/.test(scripts?.test ?? '')
      ? { testsRecursively: true }
      : undefined;
  },
  props: {
    testsRecursively: z.boolean().optional(),
  },
  produce({ options, props }) {
    if (options.taskRunner !== 'pnpm') {
      return {};
    }

    const filters = getPackageFilters(options);

    return {
      extensions: [
        // Existing recursive tests may rely on running dependencies' scripts first
        ...(props.testsRecursively
          ? []
          : [blockPnpmWorkspace({ settings: { tasks: { test: { dependsOn: [] } } } })]),
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

export const blockTurborepo = rootBase.createBlock({
  about: {
    name: 'Turborepo',
  },
  intake({ files }) {
    const existingTurbo = readText(files, 'turbo.json');
    return existingTurbo === undefined ? readRootBuild(files) : { existingTurbo };
  },
  props: {
    existingTurbo: z.string().optional(),
    rootBuild: z.string().optional(),
  },
  produce({ options, props }) {
    if (options.taskRunner !== 'turbo') {
      return {};
    }

    return {
      suggestions: describeKeptBuild(props.rootBuild, 'turbo run build'),
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
                      // Turborepo can't see that packages use the build package's configs
                      inputs: ['$TURBO_DEFAULT$', '$TURBO_ROOT$/packages/build/**'],
                      outputs: ['dist/**', 'lib/**', 'node_modules/.cache/tsbuild/**'],
                    },
                    test: {
                      // Each package's tests use the root Vitest config
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

export const blockNx = rootBase.createBlock({
  about: {
    name: 'Nx',
  },
  intake({ files }) {
    const existingNx = readText(files, 'nx.json');
    return existingNx === undefined ? readRootBuild(files) : { existingNx };
  },
  props: {
    existingNx: z.string().optional(),
    rootBuild: z.string().optional(),
  },
  produce({ options, props }) {
    if (options.taskRunner !== 'nx') {
      return {};
    }

    return {
      suggestions: describeKeptBuild(props.rootBuild, 'nx run-many --target build'),
      extensions: [
        // Other .nx folders, such as version plans, should be tracked
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

function readRootBuild(files: IntakeDirectory) {
  const scripts = parseJsonText(readText(files, 'package.json')).scripts as
    | Record<string, string>
    | undefined;
  return scripts?.build === undefined ? undefined : { rootBuild: scripts.build };
}

function describeKeptBuild(existing: string | undefined, ours: string) {
  return existing === undefined || existing.includes(ours)
    ? []
    : [
        `The root build script, \`${existing}\`, was kept. Change it to \`${ours}\` to use the task runner.`,
      ];
}

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
