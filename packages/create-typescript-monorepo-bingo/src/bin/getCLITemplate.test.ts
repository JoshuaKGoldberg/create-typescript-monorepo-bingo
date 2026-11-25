import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { template } from '../template.ts';
import { getCLITemplate } from './getCLITemplate.ts';

const root = path.resolve(import.meta.dirname, '../../../..');

describe(getCLITemplate, () => {
  let directory: string;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ctm-cli-'));
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true });
  });

  it('keeps the repository when the directory does not exist', async () => {
    const actual = await getCLITemplate(['--directory', path.join(directory, 'new')]);

    expect(actual).toBe(template);
    expect(actual.about?.repository).toEqual({
      owner: 'JoshuaKGoldberg',
      repository: 'create-typescript-monorepo-bingo',
    });
  });

  it('keeps the repository when the directory is a different repository', async () => {
    await fs.writeFile(
      path.join(directory, 'package.json'),
      JSON.stringify({ repository: { url: 'https://github.com/my-org/my-repo' } }),
    );

    const actual = await getCLITemplate(['--directory', directory]);

    expect(actual).toBe(template);
  });

  it('keeps the repository in setup mode', async () => {
    const actual = await getCLITemplate(['--mode', 'setup', '--directory', root]);

    expect(actual).toBe(template);
  });

  it.each([
    ['--directory', root],
    [`--directory=${root}`, '--mode', 'transition', '--offline'],
  ])('removes the repository when the directory is this repository: %s', async (...args) => {
    const actual = await getCLITemplate(args);

    expect(actual.about).toEqual({
      name: 'create-typescript-monorepo-bingo',
      repository: undefined,
    });
    expect(actual.produce).toBe(template.produce);
  });

  it('removes the repository when run inside of this repository', async () => {
    const actual = await getCLITemplate(['--mode', 'transition']);

    expect(actual.about?.repository).toBeUndefined();
  });
});
