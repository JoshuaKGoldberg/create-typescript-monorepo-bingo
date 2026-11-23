import type { IntakeDirectory } from 'bingo-fs';
import { z } from 'zod';

import { rootBase } from '../../bases/rootBase.ts';
import {
  findAlternateConfig,
  getDirectory,
  parseJsonText,
  readText,
  withoutAlternate,
} from '../../utils/files.ts';
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
    const alternate = findAlternateConfig(files, 'cspell');
    const existing = readText(files, 'cspell.json');
    const scripts = Object.values(
      (parseJsonText(readText(files, 'package.json'), 'package.json').scripts as
        | Record<string, string>
        | undefined) ?? {},
    );
    return {
      ...(alternate && { alternate }),
      ...(existing !== undefined && { existing }),
      // A repository that has a cspell.json but doesn't run cspell uses it for editors only.
      ...(existing !== undefined && !runsCSpell(files, scripts) && { editorOnly: true }),
    };
  },
  props: {
    alternate: z.string().optional(),
    editorOnly: z.boolean().optional(),
    existing: z.string().optional(),
    ignorePaths: z.array(z.string()).optional(),
    words: z.array(z.string()).optional(),
  },
  produce({ options, props }) {
    const existing = parseJsonText(props.existing);
    const list = (key: string) => existing[key] as string[] | undefined;

    return withoutAlternate(props.alternate, 'cspell.json', {
      extensions: props.editorOnly
        ? [blockVSCode({ extensions: ['streetsidesoftware.code-spell-checker'] })]
        : [
            blockGitHubActionsCI({
              jobs: [
                {
                  id: 'lint_spelling',
                  name: 'Lint Spelling',
                  steps: [{ run: 'pnpm lint:spelling' }],
                },
              ],
            }),
            blockRootPackageJson({
              devDependencies: pinned('cspell'),
              scripts: { 'lint:spelling': 'cspell "**" ".github/**/*"' },
            }),
            blockVSCode({ extensions: ['streetsidesoftware.code-spell-checker'] }),
          ],
      // A cspell.json that only editors use is left as it is.
      files: props.editorOnly
        ? {}
        : {
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
    });
  },
});

/**
 * Whether a repository runs cspell, from its scripts, lint-staged or workflows.
 */
function runsCSpell(files: IntakeDirectory, scripts: string[]) {
  const workflows = Object.values(getDirectory(files, '.github/workflows') ?? {});
  return (
    scripts.some((script) => script.includes('cspell')) ||
    (readText(files, 'package.json') ?? '').includes('cspell ') ||
    workflows.some((entry) => Array.isArray(entry) && /cspell/i.test(entry[0]))
  );
}
