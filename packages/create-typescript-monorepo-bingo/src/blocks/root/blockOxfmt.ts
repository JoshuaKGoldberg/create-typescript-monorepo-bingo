import { z } from 'zod';

import { rootBase } from '../../bases/rootBase.ts';
import {
  findAlternateConfig,
  isOwnedFile,
  parseJsonText,
  readText,
  withoutAlternate,
} from '../../utils/files.ts';
import { mergeList } from '../../utils/lists.ts';
import { getPackageGlobs } from '../../utils/options.ts';
import { pinned } from '../../utils/pins.ts';
import {
  hasComments,
  printStatic,
  readConfigLayout,
  readConfigObject,
  type StaticObject,
  type StaticValue,
} from '../../utils/staticConfig.ts';
import { blockGitHubActionsCI } from './blockGitHubActionsCI.ts';
import { blockRootPackageJson } from './blockRootPackageJson.ts';
import { blockRootTSConfig } from './blockRootTSConfig.ts';
import { blockVSCode } from './blockVSCode.ts';

const baseIgnorePatterns = ['.all-contributorsrc', '**/CHANGELOG.md', 'coverage', 'pnpm-lock.yaml'];

export const blockOxfmt = rootBase.createBlock({
  about: {
    name: 'Oxfmt',
  },
  intake({ files }) {
    const alternate = findAlternateConfig(files, 'oxfmt');
    const existing = readText(files, 'oxfmt.config.ts');
    const manifest = parseJsonText(readText(files, 'package.json'));
    const eslintConfig =
      readText(files, 'eslint.config.ts') ??
      readText(files, findAlternateConfig(files, 'eslint') ?? 'eslint.config.js');
    const dependencies = {
      ...(manifest.dependencies as object | undefined),
      ...(manifest.devDependencies as object | undefined),
    };
    const scripts = manifest.scripts as Record<string, string> | undefined;
    const lintStaged = manifest['lint-staged'] as Record<string, unknown> | undefined;
    return {
      ...(alternate && { alternate }),
      ...(existing !== undefined && { existing }),
      ...(readText(files, '.prettierignore') !== undefined && { hasPrettierIgnore: true }),
      // Node.js would load oxfmt.config.ts as CommonJS, where import statements fail
      ...(manifest.type === 'commonjs' && {
        rootCommonJS: true,
      }),
      // Oxfmt's blank lines between imports could conflict with existing lint rules
      ...(eslintConfig !== undefined &&
        !isOwnedFile(eslintConfig) &&
        /perfectionist\.configs|sort-imports|import\/order/.test(eslintConfig) && {
          importsLinted: true,
        }),
      // Repositories already using Oxfmt may still use Prettier for some files
      ...(existing === undefined &&
        'prettier' in dependencies &&
        !('oxfmt' in dependencies) && {
          fromPrettier: {
            format: !!scripts?.format && isPrettier(scripts.format),
            lintStaged: isPrettier(lintStaged?.['*']),
          },
        }),
    };
  },
  props: {
    alternate: z.string().optional(),
    existing: z.string().optional(),
    fromPrettier: z.object({ format: z.boolean(), lintStaged: z.boolean() }).optional(),
    hasPrettierIgnore: z.boolean().optional(),
    importsLinted: z.boolean().optional(),
    rootCommonJS: z.boolean().optional(),
    ignorePatterns: z.array(z.string()).optional(),
  },
  produce({ options, props }) {
    if (options.formatter === 'none') {
      return {
        suggestions: [
          "Formatting wasn't set up. To use Oxfmt, re-run with `--formatter oxfmt`, then run `pnpm format` once.",
        ],
      };
    }

    if (options.formatter === 'biome') {
      return {};
    }

    if (options.formatter === 'prettier') {
      return {
        extensions: [
          blockGitHubActionsCI({
            jobs: [
              {
                id: 'format_check',
                name: 'Format Check',
                steps: [{ run: 'pnpm exec prettier --check .' }],
              },
            ],
          }),
          blockRootPackageJson({
            devDependencies: pinned('prettier'),
            scripts: { format: 'prettier --write .' },
          }),
        ],
        // Prettier would otherwise reformat generated files, such as the lockfile
        files: props.hasPrettierIgnore
          ? {}
          : {
              '.prettierignore': `${[...baseIgnorePatterns, ...getPackageGlobs(options, 'dist'), ...getPackageGlobs(options, 'lib')].join('\n')}\n`,
            },
      };
    }

    const existing = readConfigObject(props.existing) ?? {};
    // Configs with comments or non-static values can't be printed back losslessly
    const keepExisting =
      props.existing !== undefined &&
      (!readConfigObject(props.existing) || hasComments(props.existing));
    const existingIgnores = Array.isArray(existing.ignorePatterns)
      ? existing.ignorePatterns.filter((pattern) => typeof pattern === 'string')
      : undefined;

    const config: StaticObject = {
      overrides: [{ files: ['.nvmrc'], options: { parser: 'yaml' } }],
      singleQuote: true,
      ...(!props.importsLinted && { sortImports: true }),
      sortPackageJson: false,
      ...existing,
      ignorePatterns: mergeList(existingIgnores, [
        ...baseIgnorePatterns,
        ...getPackageGlobs(options, 'dist'),
        ...getPackageGlobs(options, 'lib'),
        ...(props.ignorePatterns ?? []),
      ]),
    };

    const sorted = Object.fromEntries<StaticValue>(
      Object.entries(config).sort(([a], [b]) => a.localeCompare(b)),
    );

    return withoutAlternate(props.alternate, 'oxfmt.config.ts', {
      suggestions: [
        ...(props.fromPrettier
          ? [
              "Oxfmt was added. Remove Prettier's configuration files other than .prettierignore, dependencies, and VS Code settings, along with any scripts and CI jobs that still run it. Then run `pnpm format`.",
            ]
          : []),
        ...(props.rootCommonJS
          ? [
              'Oxfmt can\'t load oxfmt.config.ts because the root package.json has "type": "commonjs". Remove it or set "type": "module".',
            ]
          : []),
      ],
      extensions: [
        blockGitHubActionsCI({
          jobs: [
            {
              id: 'format_check',
              name: 'Format Check',
              steps: [{ run: 'pnpm format --list-different' }],
            },
          ],
        }),
        blockRootPackageJson({
          devDependencies: pinned('oxfmt'),
          scripts: { format: 'oxfmt' },
          replaced: {
            ...(props.fromPrettier?.format && { scripts: { format: 'oxfmt' } }),
            ...(props.fromPrettier?.lintStaged && {
              'lint-staged': { '*': 'oxfmt --no-error-on-unmatched-pattern' },
            }),
          },
        }),
        blockRootTSConfig({ addsConfigFiles: true }),
        blockVSCode({
          extensions: ['oxc.oxc-vscode'],
          settings: { 'editor.defaultFormatter': 'oxc.oxc-vscode' },
        }),
      ],
      files: {
        'oxfmt.config.ts':
          keepExisting && props.existing !== undefined
            ? props.existing
            : `import { defineConfig, type OxfmtConfig } from 'oxfmt';

const config: OxfmtConfig = defineConfig(${printStatic(sorted, readConfigLayout(props.existing))});

export default config;
`,
      },
    });
  },
});

/**
 * Whether a command is only Prettier on every file it's given.
 */
function isPrettier(command: unknown) {
  return (
    typeof command === 'string' &&
    /^prettier(?: (?:\.|-u|-w|--(?:ignore-unknown|write)))*$/.test(command)
  );
}
