import { z } from 'zod';

import { rootBase } from '../../bases/rootBase.ts';
import { defaults } from '../../options.ts';
import { readText } from '../../utils/files.ts';
import { mergeList } from '../../utils/lists.ts';
import { pinned } from '../../utils/pins.ts';
import { readESLintIgnoresWithSource } from '../../utils/staticConfig.ts';
import { blockGitHubActionsCI, type WorkflowStep } from './blockGitHubActionsCI.ts';
import { blockRootPackageJson } from './blockRootPackageJson.ts';
import { blockVSCode } from './blockVSCode.ts';

const baseIgnores = [
  '**/*.snap',
  '**/node_modules',
  'coverage',
  'packages/*/dist',
  'packages/*/lib',
  'pnpm-lock.yaml',
];

/**
 * Owns the root flat `eslint.config.ts`: typescript-eslint with `projectService`,
 * plus plugins for comments, JSDoc, regular expressions, sorting, JSON, YAML,
 * Markdown, package.json files and Vitest tests.
 * Ignores in an existing config are kept.
 */
export const blockESLint = rootBase.createBlock({
  about: {
    name: 'ESLint',
  },
  intake({ files }) {
    const existingIgnores = readESLintIgnoresWithSource(readText(files, 'eslint.config.ts'));
    return existingIgnores && { existingIgnores };
  },
  props: {
    existingIgnores: z
      .object({ lines: z.array(z.string()), values: z.array(z.string()) })
      .optional(),
    ignores: z.array(z.string()).optional(),
    lintPrebuildSteps: z.array(z.string()).optional(),
  },
  produce({ options, props }) {
    const ignores = mergeList(props.existingIgnores?.values, [
      ...baseIgnores,
      ...(props.ignores ?? []),
    ]);

    // Existing entries keep their source lines, comments included; new ones are appended.
    const existingValues = new Set(props.existingIgnores?.values);
    const ignoreLines = [
      ...(props.existingIgnores?.lines.map((line) => `      ${line.trim()}`) ?? []),
      ...ignores
        .filter((ignore) => !existingValues.has(ignore))
        .map((ignore) => `      '${ignore}',`),
    ];
    const workflowExtension = options.workflowExtension ?? defaults.workflowExtension;
    const prebuildSteps: WorkflowStep[] = (props.lintPrebuildSteps ?? []).map((run) => ({ run }));

    return {
      extensions: [
        blockGitHubActionsCI({
          jobs: [
            {
              id: 'lint',
              name: 'Lint',
              steps: [...prebuildSteps, { run: 'pnpm lint' }],
            },
          ],
        }),
        blockRootPackageJson({
          devDependencies: pinned(
            '@eslint-community/eslint-plugin-eslint-comments',
            '@eslint/js',
            '@eslint/markdown',
            '@vitest/eslint-plugin',
            'eslint',
            'eslint-plugin-jsdoc',
            'eslint-plugin-jsonc',
            'eslint-plugin-package-json',
            'eslint-plugin-perfectionist',
            'eslint-plugin-regexp',
            'eslint-plugin-yml',
            'jiti',
            'typescript-eslint',
          ),
          scripts: { lint: 'eslint . --max-warnings 0' },
        }),
        blockVSCode({
          extensions: ['dbaeumer.vscode-eslint'],
          settings: {
            'eslint.probe': [
              'javascript',
              'javascriptreact',
              'json',
              'jsonc',
              'markdown',
              'typescript',
              'typescriptreact',
              'yaml',
            ],
          },
        }),
      ],
      files: {
        'eslint.config.ts': createESLintConfig(ignoreLines, workflowExtension),
      },
    };
  },
});

function createESLintConfig(ignoreLines: string[], workflowExtension: string) {
  return `import comments from '@eslint-community/eslint-plugin-eslint-comments/configs';
import js from '@eslint/js';
import markdown from '@eslint/markdown';
import vitest from '@vitest/eslint-plugin';
import jsdoc from 'eslint-plugin-jsdoc';
import jsonc from 'eslint-plugin-jsonc';
import packageJson from 'eslint-plugin-package-json';
import perfectionist from 'eslint-plugin-perfectionist';
import * as regexp from 'eslint-plugin-regexp';
import yml from 'eslint-plugin-yml';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: [
${ignoreLines.join('\n')}
    ],
  },
  { linterOptions: { reportUnusedDisableDirectives: 'error' } },
  {
    extends: [
      comments.recommended,
      js.configs.recommended,
      jsdoc.configs['flat/contents-typescript-error'],
      jsdoc.configs['flat/logical-typescript-error'],
      jsdoc.configs['flat/stylistic-typescript-error'],
      regexp.configs['flat/recommended'],
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
    ],
    files: ['**/*.js', '**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    plugins: { perfectionist },
    rules: {
      '@typescript-eslint/consistent-type-exports': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/no-unnecessary-condition': [
        'error',
        { allowConstantLoopConditions: 'only-allowed-literals' },
      ],
      '@typescript-eslint/no-unused-vars': ['error', { caughtErrors: 'all' }],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ExportAllDeclaration[exported=null]',
          message: "Do not use 'export * from' statements. Please export individual symbols.",
        },
      ],
      'perfectionist/sort-exports': 'error',
      'perfectionist/sort-named-exports': 'error',
      'perfectionist/sort-named-imports': 'error',

      // Stylistic concerns that don't interfere with Oxfmt
      'logical-assignment-operators': ['error', 'always', { enforceForIfStatements: true }],
      'no-useless-rename': 'error',
      'object-shorthand': 'error',
      'operator-assignment': 'error',
    },
    settings: { perfectionist: { partitionByComment: true, type: 'natural' } },
  },
  {
    extends: [jsonc.configs['flat/recommended-with-json']],
    files: ['**/*.json'],
  },
  {
    extends: [packageJson.configs.recommended, packageJson.configs.stylistic],
    files: ['**/package.json'],
  },
  {
    extends: [markdown.configs.recommended],
    files: ['**/*.md'],
    ignores: ['CHANGELOG.md'],
    rules: {
      // https://github.com/eslint/markdown/issues/294
      'markdown/no-missing-label-refs': 'off',
    },
  },
  // Test only rules
  {
    extends: [vitest.configs.recommended],
    files: ['**/*.test.*'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-class-instance-assignment': 'off',
      'vitest/no-conditional-expect': 'off',
    },
    settings: { vitest: { typecheck: true } },
  },
  {
    extends: [yml.configs['flat/recommended'], yml.configs['flat/prettier']],
    files: ['**/*.{yml,yaml}'],
    rules: {
      'yml/file-extension': ['error', { extension: '${workflowExtension}' }],
      'yml/sort-sequence-values': [
        'error',
        {
          order: { type: 'asc' },
          pathPattern: '^.*$',
        },
      ],
    },
  },
  {
    files: ['pnpm-workspace.yaml'],
    rules: {
      'yml/file-extension': 'off',
      'yml/sort-keys': ['error', { order: { type: 'asc' }, pathPattern: '^.*$' }],
    },
  },
);
`;
}
