import { produceBlock } from 'bingo-stratum';
import { describe, expect, it } from 'vitest';

import type { RootOptions } from '../../options.ts';
import { blockPnpmWorkspace, resolveCatalogEntries } from './blockPnpmWorkspace.ts';

const options = {
  description: 'Test.',
  owner: 'owner',
  preset: 'root',
  repository: 'repository',
  title: 'Test',
} satisfies RootOptions & { preset: string };

describe(resolveCatalogEntries, () => {
  it('keeps an existing entry newer than the forwarded pin', () => {
    expect(
      resolveCatalogEntries(
        [
          {
            catalog: 'dev',
            dependency: 'typescript',
            specifier: 'npm:@typescript/typescript6@6.0.4',
          },
        ],
        [
          {
            catalog: 'dev',
            dependency: 'typescript',
            specifier: 'npm:@typescript/typescript6@6.0.2',
          },
        ],
      ),
    ).toEqual([
      { catalog: 'dev', dependency: 'typescript', specifier: 'npm:@typescript/typescript6@6.0.4' },
    ]);
  });

  it('replaces a plain existing entry with a forwarded alias', () => {
    expect(
      resolveCatalogEntries(
        [{ catalog: 'dev', dependency: 'typescript', specifier: '6.0.3' }],
        [
          {
            catalog: 'dev',
            dependency: 'typescript',
            specifier: 'npm:@typescript/typescript6@6.0.2',
          },
        ],
      ),
    ).toEqual([
      { catalog: 'dev', dependency: 'typescript', specifier: 'npm:@typescript/typescript6@6.0.2' },
    ]);
  });

  it('folds forwarded entries for one dependency to the largest', () => {
    expect(
      resolveCatalogEntries(
        [],
        [
          { catalog: 'prod', dependency: 'zod', specifier: '^4.4.3' },
          { catalog: 'prod', dependency: 'zod', specifier: '^4.6.0' },
        ],
      ),
    ).toEqual([{ catalog: 'prod', dependency: 'zod', specifier: '^4.6.0' }]);
  });

  it("keeps existing entries that aren't forwarded", () => {
    expect(
      resolveCatalogEntries([{ catalog: 'site', dependency: 'astro', specifier: '6.0.0' }], []),
    ).toEqual([{ catalog: 'site', dependency: 'astro', specifier: '6.0.0' }]);
  });
});

describe(blockPnpmWorkspace, () => {
  it('creates a sorted workspace file', () => {
    const creation = produceBlock(blockPnpmWorkspace, {
      options,
      props: {
        catalogEntries: [{ catalog: 'default', dependency: 'zod', specifier: '^4.6.7' }],
        settings: { trustPolicy: 'no-downgrade' },
      },
    });

    expect(creation.files?.['pnpm-workspace.yaml']).toMatchInlineSnapshot(`
      "catalog:
        zod: ^4.6.7
      packages:
        - packages/*
      trustPolicy: no-downgrade
      "
    `);
  });

  it('keeps comments, quoting and unknown keys in an existing file', () => {
    const existing = `overrides:
  '@astrojs/check@^0.9.10>chokidar': 6.0.0 # trust downgrade

packages:
  - 'packages/*'

trustPolicy: no-downgrade
`;

    const creation = produceBlock(blockPnpmWorkspace, {
      options,
      props: {
        existing,
        settings: { permissions: { 'simple-git-hooks': { build: false } } },
      },
    });

    expect(creation.files?.['pnpm-workspace.yaml']).toMatchInlineSnapshot(`
      "overrides:
        '@astrojs/check@^0.9.10>chokidar': 6.0.0 # trust downgrade

      packages:
        - 'packages/*'

      permissions:
        simple-git-hooks:
          build: false

      trustPolicy: no-downgrade
      "
    `);
  });
});
