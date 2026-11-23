import { rootBase } from '../../bases/rootBase.ts';
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
  produce() {
    return {
      extensions: [
        blockPnpmWorkspace({
          settings: { permissions: { 'simple-git-hooks': { build: false } } },
        }),
        blockRootPackageJson({
          devDependencies: pinned('lint-staged', 'simple-git-hooks'),
          properties: {
            'lint-staged': { '*': 'oxfmt --no-error-on-unmatched-pattern' },
            'simple-git-hooks': { 'pre-commit': 'pnpm lint-staged' },
          },
          scripts: { prepare: 'simple-git-hooks' },
        }),
      ],
    };
  },
});
