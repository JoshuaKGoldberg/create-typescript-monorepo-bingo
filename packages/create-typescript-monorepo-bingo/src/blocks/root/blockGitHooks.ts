import { z } from 'zod';

import { rootBase } from '../../bases/rootBase.ts';
import { getEntry, parseJsonText, readText } from '../../utils/files.ts';
import { pinned } from '../../utils/pins.ts';
import { blockPnpmWorkspace } from './blockPnpmWorkspace.ts';
import { blockRootPackageJson } from './blockRootPackageJson.ts';

/**
 * Sets up simple-git-hooks with lint-staged to format staged files on commit.
 */
export const blockGitHooks = rootBase.createBlock({
  about: {
    name: 'Git Hooks',
  },
  intake({ files }) {
    const manifest = parseJsonText(readText(files, 'package.json'), 'package.json');
    const dependencies = {
      ...(manifest.dependencies as object | undefined),
      ...(manifest.devDependencies as object | undefined),
    };
    const otherTool =
      ['husky', 'lefthook', 'nano-staged', 'pre-commit'].find((name) => name in dependencies) ??
      ['.husky', 'lefthook.yml', '.lefthook.yml', 'nano-staged.json', '.nano-staged.json'].find(
        (name) => getEntry(files, name) !== undefined,
      );
    return otherTool ? { otherTool } : undefined;
  },
  props: {
    otherTool: z.string().optional(),
  },
  produce({ options, props }) {
    // A repository with its own Git hooks setup keeps it.
    if (props.otherTool) {
      return {};
    }

    const formatCommand =
      options.formatter === 'prettier'
        ? 'prettier --ignore-unknown --write'
        : 'oxfmt --no-error-on-unmatched-pattern';

    return {
      extensions: [
        blockPnpmWorkspace({
          settings: { permissions: { 'simple-git-hooks': { build: false } } },
        }),
        blockRootPackageJson({
          devDependencies: pinned('lint-staged', 'simple-git-hooks'),
          properties: {
            'lint-staged': { '*': formatCommand },
            'simple-git-hooks': { 'pre-commit': 'pnpm lint-staged' },
          },
          scripts: { prepare: 'simple-git-hooks' },
        }),
      ],
    };
  },
});
