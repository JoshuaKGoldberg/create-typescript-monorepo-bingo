import type { IntakeDirectory } from 'bingo-fs';

import type { RootOptions } from '../options.ts';
import { parseJsonText, readText } from './files.ts';

const choiceValues = {
  formatter: ['oxfmt', 'prettier', 'biome', 'none'],
  linter: ['eslint', 'none'],
  testRunner: ['vitest', 'other'],
} as const;

/**
 * Options that can't always be inferred from a repository's files.
 */
export type Choices = Partial<Pick<RootOptions, keyof typeof choiceValues>>;

export const choicesKey = 'create-typescript-monorepo-bingo';

export function readChoices(files: IntakeDirectory): Choices {
  const manifest = parseJsonText(readText(files, 'package.json'), 'package.json');
  const value = manifest[choicesKey];
  const remembered = isChoicesObject(value) ? value : {};
  return Object.fromEntries(
    Object.entries(choiceValues).flatMap(([name, values]) => {
      const choice = remembered[name];
      return (values as readonly unknown[]).includes(choice) ? [[name, choice]] : [];
    }),
  );
}

export function getOtherChoices(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([name, choice]) =>
        !(name in choiceValues) ||
        !(choiceValues[name as keyof typeof choiceValues] as readonly unknown[]).includes(choice),
    ),
  );
}

export function isChoicesObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
