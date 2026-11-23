import { z } from 'zod';

import { rootBase } from '../../bases/rootBase.ts';
import { findAlternateConfig, readText, withoutAlternate } from '../../utils/files.ts';
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
import { blockVSCode } from './blockVSCode.ts';

const baseIgnorePatterns = ['.all-contributorsrc', '**/CHANGELOG.md', 'coverage', 'pnpm-lock.yaml'];

/**
 * Owns \`oxfmt.config.ts\`, unless the repository uses Prettier.
 * Settings and ignore patterns in an existing config are kept.
 */
export const blockOxfmt = rootBase.createBlock({
  about: {
    name: 'Oxfmt',
  },
  intake({ files }) {
    const alternate = findAlternateConfig(files, 'oxfmt');
    const fromFiles = ((): object | undefined => {
      const existing = readText(files, 'oxfmt.config.ts');
      return existing === undefined ? undefined : { existing };
    })();
    return alternate ? { ...fromFiles, alternate } : fromFiles;
  },
  props: {
    alternate: z.string().optional(),
    existing: z.string().optional(),
    ignorePatterns: z.array(z.string()).optional(),
  },
  produce({ options, props }) {
    if (options.formatter === 'prettier') {
      return {};
    }

    const existing = readConfigObject(props.existing) ?? {};
    // A config CTM can't read back statically, or with comments, is the repository's own:
    // CTM leaves it as it is rather than lose what it can't represent.
    const keepExisting =
      props.existing !== undefined &&
      (!readConfigObject(props.existing) || hasComments(props.existing));
    const existingIgnores = Array.isArray(existing.ignorePatterns)
      ? existing.ignorePatterns.filter((pattern) => typeof pattern === 'string')
      : undefined;

    const config: StaticObject = {
      overrides: [{ files: ['.nvmrc'], options: { parser: 'yaml' } }],
      singleQuote: true,
      sortImports: true,
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
        }),
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
