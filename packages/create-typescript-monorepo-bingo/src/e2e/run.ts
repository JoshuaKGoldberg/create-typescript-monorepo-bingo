/**
 * Runs the template against a directory without the interactive CLI.
 * Usage: node scripts/run.ts <setup|transition> <directory> [options JSON]
 */
import { prepareOptions, runTemplate } from 'bingo';
import { intakeDirectory } from 'bingo-fs';

import { template } from '../index.ts';

const [mode = 'setup', directory = '.', optionsJson = '{}'] = process.argv.slice(2);

if (mode !== 'setup' && mode !== 'transition') {
  throw new Error(`Unknown mode: ${mode}`);
}

const provided = JSON.parse(optionsJson) as Record<string, unknown>;
const files =
  mode === 'transition'
    ? await intakeDirectory(directory, { exclude: /node_modules|^\.git$/ })
    : undefined;

const prepared = await prepareOptions(template, {
  directory,
  existing: provided,
  ...(files && { files }),
  offline: true,
});

const creation = await runTemplate(template, {
  directory,
  ...(files && { files }),
  mode,
  offline: true,
  options: prepared as Parameters<
    typeof runTemplate<typeof template.options, unknown>
  >[1]['options'],
  skips: { requests: true },
});

console.log(
  JSON.stringify({ scripts: creation.scripts, suggestions: creation.suggestions }, null, 2),
);
