import type { IntakeDirectory } from 'bingo-fs';

import type { RootOptions } from '../options.ts';
import { getDirectory, readText } from './files.ts';

/**
 * Options whose explicit values can't always be inferred back from a repository's files.
 * They're kept as flags of the weekly transitions workflow's command instead.
 */
export const choiceValues = {
  formatter: ['oxfmt', 'prettier', 'biome', 'none'],
  linter: ['eslint', 'none'],
  testRunner: ['vitest', 'other'],
} as const;

export type Choices = Partial<Pick<RootOptions, keyof typeof choiceValues>>;

const choiceNames = Object.keys(choiceValues) as (keyof typeof choiceValues)[];

/**
 * A command that runs this template in transition mode, up to the end of its line.
 */
const commandMatcher =
  /(?:create-typescript-monorepo-bingo(?:@[\w.-]+)?|src\/bin\/index\.ts)\s[^\n]*?--mode[= ]transition\b[^\n]*/;

/**
 * Reads the choices in a transitions workflow's command.
 */
function readWorkflowChoices(workflow: string | undefined): Choices {
  const command = commandMatcher.exec(workflow ?? '')?.[0] ?? '';
  return Object.fromEntries(
    choiceNames.flatMap((name) => {
      const value = new RegExp(`--${name}[= ](\\w+)`).exec(command)?.[1];
      return (choiceValues[name] as readonly unknown[]).includes(value) ? [[name, value]] : [];
    }),
  );
}

/**
 * Reads the choices a repository's transitions workflow remembers.
 */
export function readChoices(files: IntakeDirectory): Choices {
  const workflows = getDirectory(files, '.github/workflows');
  return readWorkflowChoices(
    readText(workflows, 'transitions.yaml') ?? readText(workflows, 'transitions.yml'),
  );
}

/**
 * Prints choices as flags, like ` --linter none`.
 */
export function printChoices(choices: Choices): string {
  return choiceNames
    .map((name) => (choices[name] === undefined ? '' : ` --${name} ${choices[name]}`))
    .join('');
}

/**
 * Sets the choices in an existing workflow's command, leaving the rest as it was.
 * @returns The updated workflow, or undefined if its command couldn't be found.
 */
export function updateWorkflowChoices(workflow: string, choices: Choices): string | undefined {
  const match = commandMatcher.exec(workflow);
  if (!match) {
    return undefined;
  }

  let command = match[0];
  const existing = readWorkflowChoices(workflow);
  const added: Choices = {};
  for (const name of choiceNames) {
    if (choices[name] === undefined || choices[name] === existing[name]) {
      continue;
    }

    if (existing[name] === undefined) {
      Object.assign(added, { [name]: choices[name] });
    } else {
      command = command.replace(new RegExp(`(--${name}[= ])\\w+`), `$1${choices[name]}`);
    }
  }

  command = command.replace(/--mode[= ]transition\b/, (mode) => `${mode}${printChoices(added)}`);
  return `${workflow.slice(0, match.index)}${command}${workflow.slice(match.index + match[0].length)}`;
}
