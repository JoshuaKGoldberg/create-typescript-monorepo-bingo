import { z } from 'zod';

import { rootBase } from '../../bases/rootBase.ts';
import { defaults } from '../../options.ts';
import { action } from '../../utils/actions.ts';
import {
  describeUnownedFile,
  findAlternateConfig,
  isOwnedFile,
  ownedFileMarker,
  parseJsonText,
  readText,
  withoutAlternate,
} from '../../utils/files.ts';
import { getPackageParents, usesTaskRunner } from '../../utils/options.ts';
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
  intake({ files }) {
    const alternate = findAlternateConfig(files, 'vitest');
    const existing = readText(files, 'vitest.config.ts');
    const test = (
      parseJsonText(readText(files, 'package.json'), 'package.json').scripts as
        | Record<string, string>
        | undefined
    )?.test;
    return {
      ...(alternate && { alternate }),
      ...(!isOwnedFile(existing) && { unowned: true }),
      // A repository testing with something else, like node --test, keeps its own setup.
      ...(test !== undefined &&
        !test.includes('vitest') &&
        !/\bpnpm\b/.test(test) && { otherTestRunner: true }),
    };
  },
  props: {
    alternate: z.string().optional(),
    otherTestRunner: z.boolean().optional(),
    unowned: z.boolean().optional(),
    coverageExclude: z.array(z.string()).optional(),
  },
  produce({ options, props }) {
    if (props.otherTestRunner) {
      return {};
    }

    const coverageExclude = ['**/config.ts', ...(props.coverageExclude ?? [])]
      .map((exclude) => `'${exclude}'`)
      .join(', ');

    return withoutAlternate(props.alternate, 'vitest.config.ts', {
      suggestions: props.unowned ? [describeUnownedFile('vitest.config.ts')] : [],
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
              // A job's permissions replace the defaults, so contents: read must be listed.
              permissions: { contents: 'read', 'id-token': 'write' },
              runsOn: '${{ matrix.os }}',
              steps: [
                {
                  // Task runners run each package's tests from its own directory,
                  // so coverage comes from one root Vitest run instead.
                  run: usesTaskRunner(options)
                    ? "pnpm ${{ matrix.os == 'ubuntu-latest' && 'test:coverage' || 'test' }}"
                    : "pnpm test ${{ matrix.os == 'ubuntu-latest' && '--coverage' || '' }}",
                },
                {
                  // Fork PRs don't get an OIDC token, so they skip the upload.
                  if: "success() && (matrix.os == 'ubuntu-latest') && github.event.pull_request.head.repo.fork != true",
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
          // The Vitest config uses Node.js APIs.
          devDependencies: pinned(
            '@types/node',
            '@vitest/coverage-v8',
            'console-fail-test',
            'vitest',
          ),
          scripts: usesTaskRunner(options)
            ? { 'test:coverage': 'vitest run --coverage' }
            : { test: 'vitest' },
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
        ...(!props.unowned && {
          'vitest.config.ts': createVitestConfig(getPackageParents(options), coverageExclude),
        }),
      },
    });
  },
});

function createVitestConfig(parents: string[], coverageExclude: string) {
  const include = parents.map((parent) => `'${parent}/*/src/**/*.ts'`).join(', ');
  const project = (
    parentExpression: string,
    indent: string,
  ) => `readdirSync(path.join(import.meta.dirname, ${parentExpression}), { withFileTypes: true })
${indent}.filter((entry) => entry.isDirectory())
${indent}.map(({ name }) => ({
${indent}  test: {
${indent}    clearMocks: true,
${indent}    include: ['**/src/**/*.test.ts'],
${indent}    name,
${indent}    root: path.join(import.meta.dirname, ${parentExpression}, name),
${indent}    setupFiles: ['console-fail-test/setup'],
${indent}  },
${indent}}))`;

  const projects =
    parents.length === 1
      ? project(`'${parents[0] ?? 'packages'}'`, '      ')
      : `[${parents.map((parent) => `'${parent}'`).join(', ')}].flatMap((parent) =>
      ${project('parent', '        ')},
    )`;

  return `${ownedFileMarker}

import { readdirSync } from 'node:fs';
import path from 'node:path';

import { defaultExclude, defineConfig } from 'vitest/config';

// Untyped, so this works with every Vitest version that has projects.
const config = defineConfig({
  test: {
    // Packages without tests yet, like a new one, don't fail the run.
    passWithNoTests: true,
    coverage: {
      exclude: [...defaultExclude, ${coverageExclude}],
      include: [${include}],
      reporter: ['html', 'lcov', 'text'],
    },

    projects: ${projects},
  },
});

export default config;
`;
}
