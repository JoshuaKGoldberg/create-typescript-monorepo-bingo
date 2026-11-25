import type { IntakeDirectory } from 'bingo-fs';
import { z } from 'zod';

import { rootBase } from '../../bases/rootBase.ts';
import { defaults, type RootOptions } from '../../options.ts';
import { action } from '../../utils/actions.ts';
import {
  describeUnownedFile,
  findAlternateConfig,
  isOwnedFile,
  ownedFileMarker,
  readText,
  withoutAlternate,
} from '../../utils/files.ts';
import {
  getLibraryPackages,
  getPackageParents,
  getTopLevelPackages,
  usesTaskRunner,
} from '../../utils/options.ts';
import { pinned } from '../../utils/pins.ts';
import { blockGitHubActionsCI, getNodeVersionsMatrix } from './blockGitHubActionsCI.ts';
import { blockGitignore } from './blockGitignore.ts';
import { blockRootPackageJson } from './blockRootPackageJson.ts';
import { blockVSCode } from './blockVSCode.ts';

export const blockVitest = rootBase.createBlock({
  about: {
    name: 'Vitest',
  },
  intake({ files, options }) {
    const alternate = findAlternateConfig(files, 'vitest');
    const existing = readText(files, 'vitest.config.ts');
    return {
      ...(alternate && { alternate }),
      ...(existing !== undefined && { existing: true }),
      // Only CTM's own config has this
      ...(existing !== undefined &&
        isOwnedFile(existing) &&
        !existing.includes('console-fail-test/setup') && { replacing: true }),
      ...(!isOwnedFile(existing) && { unowned: true }),
      ...(hasTestsOutsideSources(options, files) && { testsOutsideSources: true }),
    };
  },
  props: {
    alternate: z.string().optional(),
    existing: z.boolean().optional(),
    replacing: z.boolean().optional(),
    testsOutsideSources: z.boolean().optional(),
    unowned: z.boolean().optional(),
    coverageExclude: z.array(z.string()).optional(),
  },
  produce({ options, props }) {
    if (options.testRunner === 'other') {
      return props.existing && !props.unowned
        ? {
            suggestions: [
              'Vitest is no longer used, so vitest.config.ts is no longer updated. You may want to delete it and its dependencies.',
            ],
          }
        : {};
    }

    const coverageExclude = ['**/config.ts', ...(props.coverageExclude ?? [])]
      .map((exclude) => `'${exclude}'`)
      .join(', ');

    return withoutAlternate(props.alternate, 'vitest.config.ts', {
      suggestions: [
        ...(props.unowned && !props.testsOutsideSources
          ? [describeUnownedFile('vitest.config.ts')]
          : []),
        ...(props.testsOutsideSources && props.unowned
          ? [
              `vitest.config.ts wasn't replaced because there are tests other than packages' src/**/*.test.ts files.${getLibraryPackages(options).length ? " Make sure it includes packages' src/**/*.test.ts files too." : ''}`,
            ]
          : []),
        ...(props.testsOutsideSources && props.replacing
          ? [
              "vitest.config.ts now only runs packages' src/**/*.test.ts files. Move other tests there.",
            ]
          : []),
      ],
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
              // Job permissions replace the defaults
              permissions: { contents: 'read', 'id-token': 'write' },
              runsOn: '${{ matrix.os }}',
              steps: [
                {
                  // Task runners run tests per package, so coverage needs a root run
                  run: usesTaskRunner(options)
                    ? "pnpm ${{ matrix.os == 'ubuntu-latest' && 'test:coverage' || 'test' }}"
                    : "pnpm test ${{ matrix.os == 'ubuntu-latest' && '--coverage' || '' }}",
                },
                {
                  // Fork PRs don't get an OIDC token
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
          devDependencies: pinned(
            '@types/node',
            '@vitest/coverage-v8',
            // A repository's own config may not set this up
            ...(props.unowned ? [] : ['console-fail-test' as const]),
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
          'vitest.config.ts': createVitestConfig(
            getPackageParents(options),
            getTopLevelPackages(options),
            coverageExclude,
          ),
        }),
      },
    });
  },
});

/**
 * Finds tests that the managed config wouldn't run.
 */
function hasTestsOutsideSources(
  options: RootOptions,
  directory: IntakeDirectory,
  segments: string[] = [],
): boolean {
  const path = segments.join('/');
  const inSources =
    segments.includes('src') &&
    [...getPackageParents(options), ...getTopLevelPackages(options)].some((parent) =>
      path.startsWith(`${parent}/`),
    );

  return Object.entries(directory).some(([name, entry]) => {
    if (!entry || Array.isArray(entry)) {
      return (
        /\.(?:spec|test)\.[cm]?[jt]sx?$/.test(name) && !(inSources && name.endsWith('.test.ts'))
      );
    }

    const isOutput =
      /^(?:coverage|dist|lib)$/.test(name) &&
      (!segments.length || options.packages?.some((pkg) => pkg.directory === path));
    return (
      !isOutput &&
      name !== 'node_modules' &&
      !/^\.|fixture/i.test(name) &&
      hasTestsOutsideSources(options, entry, [...segments, name])
    );
  });
}

function createVitestConfig(parents: string[], topLevel: string[], coverageExclude: string) {
  const include = [
    ...parents.map((parent) => `'${parent}/*/src/**/*.ts'`),
    ...topLevel.map((directory) => `'${directory}/src/**/*.ts'`),
  ].join(', ');
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

  if (parents.length === 1 && !topLevel.length) {
    return printVitestConfig(
      "import { readdirSync } from 'node:fs';",
      '',
      include,
      coverageExclude,
      project(`'${parents[0] ?? 'packages'}'`, '      '),
    );
  }

  const directories = `
const directories = [${parents.map((parent) => `'${parent}'`).join(', ')}]
  .flatMap((parent) =>
    existsSync(path.join(import.meta.dirname, parent))
      ? readdirSync(path.join(import.meta.dirname, parent), { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map(({ name }) => \`\${parent}/\${name}\`)
      : [],
  )
  .concat([${topLevel.map((directory) => `'${directory}'`).join(', ')}]);

// Folder names may repeat across parents
const folders = directories.map((directory) => path.posix.basename(directory));
`;

  return printVitestConfig(
    "import { existsSync, readdirSync } from 'node:fs';",
    directories,
    include,
    coverageExclude,
    `directories.map((directory, index) => ({
      test: {
        clearMocks: true,
        include: ['**/src/**/*.test.ts'],
        name:
          folders.indexOf(folders[index]) === folders.lastIndexOf(folders[index])
            ? folders[index]
            : directory,
        root: path.join(import.meta.dirname, directory),
        setupFiles: ['console-fail-test/setup'],
      },
    }))`,
  );
}

function printVitestConfig(
  fsImport: string,
  statements: string,
  include: string,
  coverageExclude: string,
  projects: string,
) {
  return `${ownedFileMarker}

${fsImport}
import path from 'node:path';

import { defaultExclude, defineConfig } from 'vitest/config';
${statements}
// Untyped to work with all Vitest versions that have projects
const config = defineConfig({
  test: {
    coverage: {
      exclude: [...defaultExclude, ${coverageExclude}],
      include: [${include}],
      reporter: ['html', 'lcov', 'text'],
    },
    passWithNoTests: true,

    projects: ${projects},
  },
});

export default config;
`;
}
