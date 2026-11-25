import type { IntakeDirectory } from 'bingo-fs';
import { z } from 'zod';

import { rootBase } from '../../bases/rootBase.ts';
import type { RootOptions } from '../../options.ts';
import {
  findAlternateConfig,
  getDirectory,
  parseJsonText,
  readText,
  withoutAlternate,
} from '../../utils/files.ts';
import { formatJson } from '../../utils/json.ts';
import { compareCaseInsensitive, compareCodeUnits, mergeList } from '../../utils/lists.ts';
import { getLibraryPackages, getPackageGlobs } from '../../utils/options.ts';
import { pinned } from '../../utils/pins.ts';
import { blockGitHubActionsCI } from './blockGitHubActionsCI.ts';
import { blockRootPackageJson } from './blockRootPackageJson.ts';
import { blockVSCode } from './blockVSCode.ts';

// .github isn't included because CSpell skips ignored paths even when passed explicitly
const baseIgnorePaths = [
  '*.tsbuildinfo',
  'CHANGELOG.md',
  'coverage',
  'node_modules',
  'pnpm-lock.yaml',
];

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
      files: props.editorOnly
        ? {}
        : {
            'cspell.json': formatJson(
              {
                ...existing,
                dictionaries: mergeList(list('dictionaries'), ['node', 'npm', 'typescript']),
                ignorePaths: mergeList(
                  list('ignorePaths'),
                  [
                    ...baseIgnorePaths,
                    ...(props.existing === undefined || getLibraryPackages(options).length
                      ? [...getPackageGlobs(options, 'dist'), ...getPackageGlobs(options, 'lib')]
                      : []),
                    ...(props.ignorePaths ?? []),
                  ],
                  compareCodeUnits,
                ),
                words: mergeList(
                  list('words'),
                  [
                    ...(list('ignorePaths')?.includes('.github') ? [] : (props.words ?? [])),
                    ...getNameWords(options, props.existing === undefined).filter(
                      (word) =>
                        !list('words')?.some((existingWord) => existingWord.toLowerCase() === word),
                    ),
                  ],
                  compareCaseInsensitive,
                ),
              },
              props.existing,
            ),
          },
    });
  },
});

/**
 * Gets words from names written to files, such as the owner in LICENSE.md.
 */
function getNameWords(options: RootOptions, isNew: boolean): string[] {
  const names = [
    ...(isNew
      ? [options.owner, options.author, options.repository, options.scope, options.title]
      : []),
    // Existing packages already use their scope
    isUsedScope(options) ? options.newPackage?.split('/')[1] : options.newPackage,
    ...(options.keywords ?? []),
  ];
  // CSpell skips words shorter than four letters
  return [
    ...new Set(
      names
        .flatMap((name) => name?.split(/\P{L}+/u) ?? [])
        .filter((word) => word.length >= 4)
        .map((word) => word.toLowerCase()),
    ),
  ];
}

function isUsedScope({ newPackage, packages }: RootOptions) {
  const scope = /^@[^/]+\//.exec(newPackage ?? '')?.[0];
  return (
    scope !== undefined &&
    !!packages?.some(
      (pkg) => pkg.kind !== 'build' && pkg.name !== newPackage && pkg.name.startsWith(scope),
    )
  );
}

function runsCSpell(files: IntakeDirectory, scripts: string[]) {
  const workflows = Object.values(getDirectory(files, '.github/workflows') ?? {});
  return (
    scripts.some((script) => script.includes('cspell')) ||
    (readText(files, 'package.json') ?? '').includes('cspell ') ||
    workflows.some((entry) => Array.isArray(entry) && /cspell/i.test(entry[0]))
  );
}
