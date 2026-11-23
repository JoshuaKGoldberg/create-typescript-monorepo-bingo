import { z } from 'zod';

import { rootBase } from '../../bases/rootBase.ts';
import { defaults } from '../../options.ts';
import { action } from '../../utils/actions.ts';
import { usesTaskRunner } from '../../utils/options.ts';
import { pinned } from '../../utils/pins.ts';
import { blockGitHubActionsCI, getNodeVersionsMatrix } from './blockGitHubActionsCI.ts';
import { blockGitignore } from './blockGitignore.ts';
import { blockRootPackageJson } from './blockRootPackageJson.ts';
import { blockVSCode } from './blockVSCode.ts';

/**
 * Owns the root `vitest.config.ts`, with one Vitest project per workspace package,
 * plus the Node.js and OS test matrices in CI and Codecov uploads through OIDC.
 */
export const blockVitest = rootBase.createBlock({
  about: {
    name: 'Vitest',
  },
  props: {
    coverageExclude: z.array(z.string()).optional(),
  },
  produce({ options, props }) {
    const coverageExclude = ['**/config.ts', ...(props.coverageExclude ?? [])]
      .map((exclude) => `'${exclude}'`)
      .join(', ');

    return {
      extensions: [
        blockGitHubActionsCI({
          jobs: [
            {
              id: 'test_node',
              name: 'Test (Node.js ${{ matrix.node-version }})',
              setup: { 'node-version': '${{ matrix.node-version }}' },
              steps: [{ run: 'pnpm test' }],
              strategy: {
                'fail-fast': false,
                matrix: {
                  'node-version': getNodeVersionsMatrix(
                    options.nodeEngines ?? defaults.nodeEngines,
                  ),
                },
              },
            },
            {
              id: 'test_os',
              name: 'Test (${{ matrix.os }})',
              permissions: { 'id-token': 'write' },
              runsOn: '${{ matrix.os }}',
              steps: [
                { run: "pnpm test ${{ matrix.os == 'ubuntu-latest' && '--coverage' || '' }}" },
                {
                  if: "success() && (matrix.os == 'ubuntu-latest')",
                  uses: action('codecov/codecov-action'),
                  with: { fail_ci_if_error: true, use_oidc: true },
                },
              ],
              strategy: {
                'fail-fast': false,
                matrix: { os: ['macos-latest', 'ubuntu-latest', 'windows-latest'] },
              },
            },
          ],
        }),
        blockGitignore({ ignores: ['coverage/'] }),
        blockRootPackageJson({
          devDependencies: pinned('@vitest/coverage-v8', 'console-fail-test', 'vitest'),
          scripts: usesTaskRunner(options) ? {} : { test: 'vitest' },
        }),
        blockVSCode({
          extensions: ['vitest.explorer'],
          launch: {
            configurations: [
              {
                args: ['run', '${relativeFile}'],
                autoAttachChildProcesses: true,
                console: 'integratedTerminal',
                name: 'Debug Current Test File',
                program: '${workspaceRoot}/node_modules/vitest/vitest.mjs',
                request: 'launch',
                skipFiles: ['<node_internals>/**', '**/node_modules/**'],
                smartStep: true,
                type: 'node',
              },
            ],
            version: '0.2.0',
          },
        }),
      ],
      files: {
        'vitest.config.ts': `import { readdirSync } from 'node:fs';
import path from 'node:path';

import { defaultExclude, defineConfig, type ViteUserConfigExport } from 'vitest/config';

const config: ViteUserConfigExport = defineConfig({
  test: {
    coverage: {
      exclude: [...defaultExclude, ${coverageExclude}],
      include: ['packages/*/src/**/*.ts'],
      reporter: ['html', 'lcov', 'text'],
    },

    projects: readdirSync(path.join(import.meta.dirname, 'packages')).map((name) => ({
      test: {
        clearMocks: true,
        include: ['**/src/**/*.test.ts'],
        name,
        root: path.join(import.meta.dirname, 'packages', name),
        setupFiles: ['console-fail-test/setup'],
      },
    })),
  },
});

export default config;
`,
      },
    };
  },
});
