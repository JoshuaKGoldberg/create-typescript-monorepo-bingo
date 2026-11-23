import type { IntakeDirectory } from 'bingo-fs';

import type { RootOptions } from '../options.ts';
import { parseJsonText, readText } from './files.ts';

const choiceValues = {
  formatter: ['oxfmt', 'prettier', 'biome', 'none'],
  linter: ['eslint', 'none'],
  testRunner: ['vitest', 'other'],
} as const;

/**
 * Options whose explicit values can't always be inferred back from a repository's files.
 */
export type Choices = Partial<Pick<RootOptions, keyof typeof choiceValues>>;

/**
 * The root package.json property that remembers those.
 */
export const choicesKey = 'create-typescript-monorepo-bingo';

/**
 * Reads the choices a repository's root package.json remembers.
 */
export function readChoices(files: IntakeDirectory): Choices {
  const manifest = parseJsonText(readText(files, 'package.json'), 'package.json');
  const remembered = manifest[choicesKey] as Record<string, unknown> | null | undefined;
  return Object.fromEntries(
    Object.entries(choiceValues).flatMap(([name, values]) => {
      const value = remembered?.[name];
      return (values as readonly unknown[]).includes(value) ? [[name, value]] : [];
    }),
  );
}
