import { z } from 'zod';

import { rootBase } from '../../bases/rootBase.ts';
import { parseJsonText, readText } from '../../utils/files.ts';
import { formatJson } from '../../utils/json.ts';
import { compareCaseInsensitive, mergeList } from '../../utils/lists.ts';
import { getPackageGlobs } from '../../utils/options.ts';
import { pinned } from '../../utils/pins.ts';
import { blockGitHubActionsCI } from './blockGitHubActionsCI.ts';
import { blockRootPackageJson } from './blockRootPackageJson.ts';
import { blockVSCode } from './blockVSCode.ts';

// .github isn't ignored: cspell skips ignored paths even when they're passed explicitly.
const baseIgnorePaths = [
  '*.tsbuildinfo',
  'CHANGELOG.md',
  'coverage',
  'node_modules',
  'pnpm-lock.yaml',
];

/**
 * Owns `cspell.json`. Existing words, ignore paths and settings are kept.
 */
export const blockCSpell = rootBase.createBlock({
  about: {
    name: 'CSpell',
  },
  intake({ files }) {
    const existing = readText(files, 'cspell.json');
    return existing === undefined ? undefined : { existing };
  },
  props: {
    existing: z.string().optional(),
    ignorePaths: z.array(z.string()).optional(),
    words: z.array(z.string()).optional(),
  },
  produce({ options, props }) {
    const existing = parseJsonText(props.existing);
    const list = (key: string) => existing[key] as string[] | undefined;

    return {
      extensions: [
        blockGitHubActionsCI({
          jobs: [
            { id: 'lint_spelling', name: 'Lint Spelling', steps: [{ run: 'pnpm lint:spelling' }] },
          ],
        }),
        blockRootPackageJson({
          devDependencies: pinned('cspell'),
          scripts: { 'lint:spelling': 'cspell "**" ".github/**/*"' },
        }),
        blockVSCode({ extensions: ['streetsidesoftware.code-spell-checker'] }),
      ],
      files: {
        'cspell.json': formatJson(
          {
            ...existing,
            dictionaries: mergeList(list('dictionaries'), ['node', 'npm', 'typescript']),
            ignorePaths: mergeList(list('ignorePaths'), [
              ...baseIgnorePaths,
              ...getPackageGlobs(options, 'dist'),
              ...getPackageGlobs(options, 'lib'),
              ...(props.ignorePaths ?? []),
            ]),
            words: mergeList(list('words'), props.words ?? [], compareCaseInsensitive),
          },
          props.existing,
        ),
      },
    };
  },
});
