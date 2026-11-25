import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { template, templateRepository } from '../template.ts';

/**
 * Bingo uses `about.repository` to create new repositories from the template repository.
 * It also clears all files when transitioning a checkout of that repository, and amends and
 * force pushes its last commit. This repository transitions itself, so it has to be excluded.
 */
export async function getCLITemplate(args: string[]): Promise<typeof template> {
  const { values } = parseArgs({
    args,
    options: { directory: { type: 'string' }, mode: { type: 'string' } },
    strict: false,
  });

  if (
    values.mode === 'setup' ||
    !(await isTemplateCheckout(typeof values.directory === 'string' ? values.directory : '.'))
  ) {
    return template;
  }

  return { ...template, about: { ...template.about, repository: undefined } };
}

async function isTemplateCheckout(directory: string) {
  try {
    const contents = await fs.readFile(path.join(directory, 'package.json'), 'utf8');

    return contents
      .toLowerCase()
      .includes(`${templateRepository.owner}/${templateRepository.repository}`.toLowerCase());
  } catch {
    return false;
  }
}
