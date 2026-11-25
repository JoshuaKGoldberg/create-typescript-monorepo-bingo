import type { IntakeDirectory } from 'bingo-fs';
import { sortPackageJson } from 'sort-package-json';
import { z } from 'zod';

import { rootBase } from '../../bases/rootBase.ts';
import { defaults, type RootOptions } from '../../options.ts';
import {
  describeUnownedFile,
  findAlternateConfig,
  getEntry,
  isOwnedFile,
  ownedFileMarker,
  parseJsonText,
  readText,
  withoutAlternate,
} from '../../utils/files.ts';
import { hasSameKeyOrder, hasSortedKeys, sortKeys } from '../../utils/json.ts';
import { compareCodeUnits, mergeList } from '../../utils/lists.ts';
import { getPackageGlobs } from '../../utils/options.ts';
import { pinned } from '../../utils/pins.ts';
import {
  isParseable,
  readESLintExtras,
  readESLintIgnoresWithSource,
} from '../../utils/staticConfig.ts';
import { getMinimumVersion } from '../../utils/versions.ts';
import { blockGitHubActionsCI, type WorkflowStep } from './blockGitHubActionsCI.ts';
import { blockRootPackageJson } from './blockRootPackageJson.ts';
import { blockRootTSConfig } from './blockRootTSConfig.ts';
import { blockVSCode } from './blockVSCode.ts';

const baseIgnores = ['**/*.snap', '**/node_modules', 'coverage', 'pnpm-lock.yaml'];

export const blockESLint = rootBase.createBlock({
  about: {
    name: 'ESLint',
  },
  intake({ files, options }) {
    const alternate = findAlternateConfig(files, 'eslint');
    const existing = readText(files, 'eslint.config.ts');
    // ESLint 10 can't read legacy configs
    const legacy = [
      '.eslintrc',
      '.eslintrc.cjs',
      '.eslintrc.js',
      '.eslintrc.json',
      '.eslintrc.yaml',
      '.eslintrc.yml',
    ].find((name) => getEntry(files, name) !== undefined);
    const existingIgnores = readESLintIgnoresWithSource(existing);
    const rootManifest = parseJsonText(readText(files, 'package.json'));
    const eslintSpecifier = [rootManifest.devDependencies, rootManifest.dependencies]
      .map((dependencies) => (dependencies as Record<string, string> | undefined)?.eslint)
      .find((specifier) => specifier !== undefined);
    const eslintMinimum = getMinimumVersion(
      'eslint',
      eslintSpecifier,
      readText(files, 'pnpm-workspace.yaml'),
    );
    const keepsVitest = keepsVitestLint(files, existing, options);
    const vitest = options.testRunner !== 'other' || keepsVitest;
    const packageJsonRulesOff = findMissingPackageFields(files, options);
    const extras = readESLintExtras(
      existing,
      createESLintConfig(
        '',
        options.workflowExtension ?? defaults.workflowExtension,
        undefined,
        vitest,
        options.formatter !== 'biome',
        packageJsonRulesOff,
        getUntypedFiles(options),
      ),
      // Only CTM's own Vitest entry is dropped, so that entries for other test runners stay
      {
        configs: [previousVitestConfigEntry, ...(vitest ? [] : [vitestConfigEntry])],
        imports: vitest ? [] : [vitestImport],
        namePrefix: ownEntryPrefix,
      },
    );
    return {
      ...(alternate && { alternate }),
      ...(existing === undefined &&
        !alternate &&
        !legacy &&
        Object.keys(files).length > 0 && { adopting: true }),
      ...(existing !== undefined && isOwnedFile(existing) && { managed: true }),
      ...(keepsVitest && { keepsVitest }),
      ...(packageJsonRulesOff.length && { packageJsonRulesOff }),
      ...(eslintMinimum && eslintMinimum.major < 9 && { oldESLint: eslintSpecifier }),
      ...(existingIgnores && { existingIgnores }),
      ...(extras && { extras }),
      ...(existing !== undefined && !isParseable(existing) && { unparseable: true }),
      ...(!isOwnedFile(existing) && { unowned: true }),
      ...(legacy && { legacy }),
    };
  },
  props: {
    alternate: z.string().optional(),
    legacy: z.string().optional(),
    adopting: z.boolean().optional(),
    keepsVitest: z.boolean().optional(),
    managed: z.boolean().optional(),
    oldESLint: z.string().optional(),
    packageJsonRulesOff: z.array(z.string()).optional(),
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
    if (options.linter === 'none') {
      return props.managed
        ? {
            suggestions: [
              'ESLint is turned off, so eslint.config.ts is no longer updated. You may want to delete it and its CI job, dependencies, and script.',
            ],
          }
        : {};
    }

    const vitest = options.testRunner !== 'other' || !!props.keepsVitest;

    if (props.oldESLint) {
      return {
        suggestions: [
          `ESLint ${props.oldESLint} is older than 9, so eslint.config.ts wasn't added. Update ESLint and re-run to add it.`,
        ],
      };
    }

    if (props.unowned) {
      return {
        suggestions: [
          `${describeUnownedFile('eslint.config.ts')} Entries like the template's own are replaced, so move any of their other rules to separate entries first.`,
        ],
      };
    }

    const ignores = mergeList(props.existingIgnores?.values, [
      ...baseIgnores,
      ...getPackageGlobs(options, 'dist'),
      ...getPackageGlobs(options, 'lib'),
      ...(props.ignores ?? []),
    ]);

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
        ...(props.adopting
          ? [
              'ESLint was added with strict rules. Files must be included in a tsconfig.json for typed linting. See https://github.com/JoshuaKGoldberg/create-typescript-monorepo-bingo/blob/main/docs/FAQs.md#how-can-i-suppress-existing-eslint-complaints.',
            ]
          : []),
        ...(props.unparseable
          ? [
              "eslint.config.ts couldn't be parsed, so it wasn't updated. Fix its syntax and re-run.",
            ]
          : []),
        ...(props.legacy
          ? [
              `ESLint 10 doesn't support ${props.legacy}. Move its settings into eslint.config.ts, then delete it.`,
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
            // Vitest's rules would rewrite other test runners' imports, such as node:test's
            ...(vitest ? ['@vitest/eslint-plugin' as const] : []),
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
        blockRootTSConfig({ addsConfigFiles: true }),
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
        ...(!props.unparseable && {
          'eslint.config.ts': createESLintConfig(
            ignoresText,
            workflowExtension,
            props.extras,
            vitest,
            // Biome sorts imports and exports in its own order
            options.formatter !== 'biome',
            props.packageJsonRulesOff,
            getUntypedFiles(options),
          ),
        }),
      },
    });
  },
});

/**
 * Distinguishes entries that CTM sometimes writes from the repository's own.
 */
const ownEntryPrefix = 'create-typescript-monorepo-bingo/';

const vitestImport = "import vitest from '@vitest/eslint-plugin';";

const vitestConfigEntry = `{
    extends: [vitest.configs.recommended],
    files: ['**/*.test.{js,ts}'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-class-instance-assignment': 'off',
      'vitest/no-conditional-expect': 'off',
    },
    settings: { vitest: { typecheck: true } },
  }`;

// Older versions of CTM wrote this entry, so it's replaced rather than kept
const previousVitestConfigEntry = `{
    extends: [vitest.configs.recommended],
    files: ['**/*.test.*'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-class-instance-assignment': 'off',
      'vitest/no-conditional-expect': 'off',
    },
    settings: { vitest: { typecheck: true } },
  }`;

const ownImports = [
  [
    '@eslint-community/eslint-plugin-eslint-comments/configs',
    "import comments from '@eslint-community/eslint-plugin-eslint-comments/configs';",
  ],
  ['@eslint/js', "import js from '@eslint/js';"],
  ['@eslint/markdown', "import markdown from '@eslint/markdown';"],
  ['@vitest/eslint-plugin', vitestImport],
  ['eslint-plugin-jsdoc', "import jsdoc from 'eslint-plugin-jsdoc';"],
  ['eslint-plugin-jsonc', "import jsonc from 'eslint-plugin-jsonc';"],
  ['eslint-plugin-package-json', "import packageJson from 'eslint-plugin-package-json';"],
  ['eslint-plugin-perfectionist', "import perfectionist from 'eslint-plugin-perfectionist';"],
  ['eslint-plugin-regexp', "import * as regexp from 'eslint-plugin-regexp';"],
  ['eslint-plugin-yml', "import yml from 'eslint-plugin-yml';"],
  ['eslint/config', "import { defineConfig } from 'eslint/config';"],
  ['typescript-eslint', "import tseslint from 'typescript-eslint';"],
] as const;

const importPattern = /^import [^\n]* from ['"]([^'"\n]+)['"];?$/;

function getModule(line: string) {
  return importPattern.exec(line)?.[1] ?? '';
}

/**
 * Changes to CTM's own entries are replaced, but added entries and imports are kept.
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
  sorting = true,
  packageJsonRulesOff: string[] = [],
  untypedFiles: string[] = [],
) {
  const replaced = new Set(extras?.replacedImports);
  if (!vitest) {
    replaced.add('@vitest/eslint-plugin');
  }
  const imports = [
    ...ownImports.filter(([module]) => !replaced.has(module)).map(([, line]) => line),
    ...(extras?.imports ?? []),
  ];
  // Existing lint rules may sort imports, while other layouts are kept
  if (imports.every((line) => importPattern.test(line))) {
    imports.sort((a, b) => compareCodeUnits(getModule(a), getModule(b)));
  }
  return `${ownedFileMarker}

${extras?.header.filter((comment) => comment !== ownedFileMarker).length ? `${extras.header.filter((comment) => comment !== ownedFileMarker).join('\n')}\n\n` : ''}${imports.map((line) => `${line}\n`).join('')}${extras?.statements.length ? `\n${extras.statements.join('\n\n')}\n` : ''}
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
          message: "Do not use 'export * from' statements. Please export individual symbols.",
          selector: 'ExportAllDeclaration[exported=null]',
        },
      ],
${
  sorting
    ? `      'perfectionist/sort-exports': 'error',
      'perfectionist/sort-named-exports': 'error',
      'perfectionist/sort-named-imports': 'error',
`
    : ''
}
      // Stylistic concerns that don't interfere with formatters
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
${
  untypedFiles.length
    ? `  {
    // Config files that aren't in any tsconfig.json
    extends: [tseslint.configs.disableTypeChecked],
    files: [${untypedFiles.map((file) => `'${file}'`).join(', ')}],
    name: '${ownEntryPrefix}untyped-config-files',
  },
`
    : ''
}${
    packageJsonRulesOff.length
      ? `  {
    // Rules that existing package.json files don't meet yet
    files: ['**/package.json'],
    name: '${ownEntryPrefix}missing-package-fields',
    rules: {
${packageJsonRulesOff.map((rule) => `      'package-json/${rule}': 'off',`).join('\n')}
    },
  },
`
      : ''
  }  {
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
  ${vitestConfigEntry},
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

const requiredFields: [
  rule: string,
  has: (manifest: Record<string, unknown>) => boolean,
  checksPrivate: boolean,
][] = [
  ['require-attribution', (manifest) => !!manifest.author || !!manifest.contributors, false],
  ['require-description', (manifest) => !!manifest.description, true],
  ['require-exports', (manifest) => manifest.exports !== undefined, false],
  ['require-files', (manifest) => manifest.files !== undefined, false],
  ['require-license', (manifest) => !!manifest.license, false],
  ['require-name', (manifest) => !!manifest.name, false],
  ['require-repository', (manifest) => !!manifest.repository, false],
  ['require-sideEffects', (manifest) => manifest.sideEffects !== undefined, false],
  ['require-type', (manifest) => !!manifest.type, true],
  ['require-version', (manifest) => !!manifest.version, false],
];

/**
 * Gets config files that aren't in any tsconfig.
 */
function getUntypedFiles(options: RootOptions): string[] {
  return options.buildPackageSkipped
    ? ['*.config.{js,ts}', ...getPackageGlobs(options, '*.config.{js,ts}')]
    : [];
}

/**
 * Whether to keep Vitest lint rules because packages use it without a root config.
 */
function keepsVitestLint(
  files: IntakeDirectory,
  existing: string | undefined,
  options: RootOptions,
) {
  const hasRootConfig =
    readText(files, 'vitest.config.ts') !== undefined || options.vitestConfig !== undefined;
  return (
    /import vitest from ['"]@vitest\/eslint-plugin['"]/.test(existing ?? '') &&
    !hasRootConfig &&
    ['.', ...(options.packages ?? []).map((pkg) => pkg.directory)].some((directory) => {
      const path = directory === '.' ? 'package.json' : `${directory}/package.json`;
      const { dependencies, devDependencies } = parseJsonText(readText(files, path), path);
      return 'vitest' in { ...(dependencies as object), ...(devDependencies as object) };
    })
  );
}

/**
 * Collections checked by package-json/sort-collections, except dependencies.
 */
const sortedCollections = ['config', 'exports', 'overrides', 'peerDependenciesMeta', 'scripts'];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Finds package.json lint rules that existing packages would fail.
 */
function findMissingPackageFields(files: IntakeDirectory, options: RootOptions): string[] {
  const manifests = [
    { filled: ['require-description', 'require-repository'], path: 'package.json' },
    ...(options.packages ?? []).map((pkg) => ({
      filled: pkg.kind === 'library' ? ['require-name', 'require-repository'] : [],
      path: `${pkg.directory}/package.json`,
    })),
  ].flatMap(({ filled, path }) => {
    const text = readText(files, path);
    return text === undefined ? [] : [{ filled, manifest: parseJsonText(text) }];
  });

  // These rules would report on unsorted keys, which CTM doesn't reorder
  const unsortedKeys = manifests.some(({ manifest }) => !hasSortedKeys(manifest));
  const unsortedCollections = manifests.some(({ manifest }) =>
    sortedCollections.some(
      (name) =>
        isPlainObject(manifest[name]) &&
        !hasSameKeyOrder(
          manifest[name],
          name === 'scripts'
            ? (sortPackageJson({ scripts: manifest.scripts }).scripts as object)
            : sortKeys(manifest[name]),
        ),
    ),
  );

  return [
    ...requiredFields
      .filter(([rule, has, checksPrivate]) =>
        manifests.some(
          ({ filled, manifest }) =>
            !filled.includes(rule) &&
            (checksPrivate || manifest.private !== true) &&
            !has(manifest),
        ),
      )
      .map(([rule]) => rule),
    ...(unsortedKeys ? ['order-properties'] : []),
    ...(unsortedCollections ? ['sort-collections'] : []),
  ];
}
