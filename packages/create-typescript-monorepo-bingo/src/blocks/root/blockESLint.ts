import { z } from 'zod';

import { rootBase } from '../../bases/rootBase.ts';
import { defaults } from '../../options.ts';
import {
  describeUnownedFile,
  findAlternateConfig,
  getEntry,
  isOwnedFile,
  ownedFileMarker,
  readText,
  withoutAlternate,
} from '../../utils/files.ts';
import { mergeList } from '../../utils/lists.ts';
import { getPackageGlobs } from '../../utils/options.ts';
import { pinned } from '../../utils/pins.ts';
import {
  isParseable,
  readESLintExtras,
  readESLintIgnoresWithSource,
} from '../../utils/staticConfig.ts';
import { blockGitHubActionsCI, type WorkflowStep } from './blockGitHubActionsCI.ts';
import { blockRootPackageJson } from './blockRootPackageJson.ts';
import { blockVSCode } from './blockVSCode.ts';

const baseIgnores = ['**/*.snap', '**/node_modules', 'coverage', 'pnpm-lock.yaml'];

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
  intake({ files, options }) {
    const alternate = findAlternateConfig(files, 'eslint');
    const existing = readText(files, 'eslint.config.ts');
    // ESLint 10 can't read legacy configs, so they're replaced, with a suggestion to delete.
    const legacy = [
      '.eslintrc',
      '.eslintrc.cjs',
      '.eslintrc.js',
      '.eslintrc.json',
      '.eslintrc.yaml',
      '.eslintrc.yml',
    ].find((name) => getEntry(files, name) !== undefined);
    const existingIgnores = readESLintIgnoresWithSource(existing);
    const extras = readESLintExtras(
      existing,
      createESLintConfig(
        '',
        options.workflowExtension ?? defaults.workflowExtension,
        undefined,
        options.testRunner !== 'other',
      ),
    );
    return {
      ...(alternate && { alternate }),
      ...(existingIgnores && { existingIgnores }),
      ...(extras && { extras }),
      ...(existing !== undefined && !isParseable(existing) && { unparseable: true }),
      // A config CTM didn't create is the repository's, like the other owned files.
      ...(!isOwnedFile(existing) && { unowned: true }),
      ...(legacy && { legacy }),
    };
  },
  props: {
    alternate: z.string().optional(),
    legacy: z.string().optional(),
    unowned: z.boolean().optional(),
    unparseable: z.boolean().optional(),
    extras: z
      .object({
        configs: z.array(z.string()),
        exportComments: z.array(z.string()),
        header: z.array(z.string()),
        imports: z.array(z.string()),
        replacedImports: z.array(z.string()),
        statements: z.array(z.string()),
        trailing: z.array(z.string()),
      })
      .optional(),
    existingIgnores: z
      .object({
        inner: z.string(),
        insertAt: z.number(),
        needsCommaAt: z.number().optional(),
        values: z.array(z.string()),
      })
      .optional(),
    ignores: z.array(z.string()).optional(),
    lintPrebuildSteps: z.array(z.string()).optional(),
  },
  produce({ options, props }) {
    if (props.unowned) {
      return { suggestions: [describeUnownedFile('eslint.config.ts')] };
    }

    const ignores = mergeList(props.existingIgnores?.values, [
      ...baseIgnores,
      ...getPackageGlobs(options, 'dist'),
      ...getPackageGlobs(options, 'lib'),
      ...(props.ignores ?? []),
    ]);

    // Existing entries and comments stay exactly as written; new ones go after the last entry.
    const existingValues = new Set(props.existingIgnores?.values);
    const quote = (ignore: string) => `'${ignore.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
    const added = ignores.filter((ignore) => !existingValues.has(ignore)).map(quote);
    const existingIgnores = props.existingIgnores;
    const ignoresText =
      existingIgnores && existingIgnores.insertAt > 0
        ? insertIgnores(existingIgnores, added)
        : `\n${added.map((ignore) => `      ${ignore},`).join('\n')}\n    `;
    const workflowExtension = options.workflowExtension ?? defaults.workflowExtension;
    const prebuildSteps: WorkflowStep[] = (props.lintPrebuildSteps ?? []).map((run) => ({ run }));

    return withoutAlternate(props.alternate, 'eslint.config.ts', {
      suggestions: [
        ...(props.unparseable
          ? [
              "eslint.config.ts couldn't be parsed, so it wasn't updated. Fix its syntax and re-run.",
            ]
          : []),
        ...(props.legacy
          ? [
              `ESLint 10 doesn't read ${props.legacy}: move its settings into eslint.config.ts, then delete it.`,
            ]
          : []),
      ],
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
            // Vitest's rules would rewrite other test runners' imports, like node:test's.
            ...(options.testRunner === 'other' ? [] : ['@vitest/eslint-plugin' as const]),
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
        // A config that doesn't parse is left as it is, rather than lose what can't be read.
        ...(!props.unparseable && {
          'eslint.config.ts': createESLintConfig(
            ignoresText,
            workflowExtension,
            props.extras,
            options.testRunner !== 'other',
          ),
        }),
      },
    });
  },
});

const ownImports = [
  [
    '@eslint-community/eslint-plugin-eslint-comments/configs',
    "import comments from '@eslint-community/eslint-plugin-eslint-comments/configs';",
  ],
  ['@eslint/js', "import js from '@eslint/js';"],
  ['@eslint/markdown', "import markdown from '@eslint/markdown';"],
  ['@vitest/eslint-plugin', "import vitest from '@vitest/eslint-plugin';"],
  ['eslint-plugin-jsdoc', "import jsdoc from 'eslint-plugin-jsdoc';"],
  ['eslint-plugin-jsonc', "import jsonc from 'eslint-plugin-jsonc';"],
  ['eslint-plugin-package-json', "import packageJson from 'eslint-plugin-package-json';"],
  ['eslint-plugin-perfectionist', "import perfectionist from 'eslint-plugin-perfectionist';"],
  ['eslint-plugin-regexp', "import * as regexp from 'eslint-plugin-regexp';"],
  ['eslint-plugin-yml', "import yml from 'eslint-plugin-yml';"],
  ['eslint/config', "import { defineConfig } from 'eslint/config';"],
  ['typescript-eslint', "import tseslint from 'typescript-eslint';"],
] as const;

/**
 * Creates CTM's flat ESLint config. Config entries and imports a repository added are
 * kept after CTM's own; edits inside CTM's own entries are replaced on transition.
 */
function createESLintConfig(
  ignoresText: string,
  workflowExtension: string,
  extras?: {
    configs: string[];
    exportComments: string[];
    header: string[];
    imports: string[];
    replacedImports: string[];
    statements: string[];
    trailing: string[];
  },
  vitest = true,
) {
  const replaced = new Set(extras?.replacedImports);
  if (!vitest) {
    replaced.add('@vitest/eslint-plugin');
  }
  return `${ownedFileMarker}

${extras?.header.filter((comment) => comment !== ownedFileMarker).length ? `${extras.header.filter((comment) => comment !== ownedFileMarker).join('\n')}\n\n` : ''}${ownImports
    .filter(([module]) => !replaced.has(module))
    .map(([, line]) => `${line}\n`)
    .join(
      '',
    )}${extras?.imports.length ? `${extras.imports.join('\n')}\n` : ''}${extras?.statements.length ? `\n${extras.statements.join('\n\n')}\n` : ''}
${extras?.exportComments.length ? `${extras.exportComments.join('\n')}\n` : ''}export default defineConfig(
  {
    ignores: [${ignoresText}],
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
${
  vitest
    ? `  // Test only rules
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
`
    : ''
}  {
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
  },${extras?.configs.length ? `\n${extras.configs.map((config) => `  ${config},`).join('\n')}` : ''}${extras?.trailing.length ? `\n  ${extras.trailing.join('\n  ')}` : ''}
);
`;
}

function insertIgnores(
  { inner, insertAt, needsCommaAt }: { inner: string; insertAt: number; needsCommaAt?: number },
  added: string[],
) {
  if (!added.length) {
    return inner;
  }

  const withComma =
    needsCommaAt === undefined
      ? inner
      : `${inner.slice(0, needsCommaAt)},${inner.slice(needsCommaAt)}`;
  const at = insertAt + (needsCommaAt === undefined ? 0 : 1);
  const insertion = added.map((ignore) => `\n      ${ignore},`).join('');
  return `${withComma.slice(0, at)}${insertion}${withComma.slice(at)}`;
}
