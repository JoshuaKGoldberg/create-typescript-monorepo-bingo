import { describe, expect, it } from 'vitest';

import type { RootOptions } from '../options.ts';
import { resolveDependencies } from './catalogs.ts';

const options = {
  description: 'Test.',
  owner: 'owner',
  repository: 'repository',
  title: 'Test',
} satisfies RootOptions;

describe(resolveDependencies, () => {
  it('keeps existing dependencies and adds ours without catalogs', () => {
    expect(
      resolveDependencies(
        { ...options, catalogs: 'none' },
        'devDependencies',
        { other: '1.0.0', vitest: '5.0.0' },
        { vitest: '5.1.1' },
      ),
    ).toEqual({
      catalogEntries: [],
      dependencies: { other: '1.0.0', vitest: '5.0.0' },
    });
  });

  it('moves every literal dependency into its field catalog in named mode', () => {
    expect(
      resolveDependencies(
        { ...options, catalogs: 'named' },
        'peerDependencies',
        { a: 'workspace:^', zod: '^4.4.3' },
        undefined,
      ),
    ).toEqual({
      catalogEntries: [{ catalog: 'peer', dependency: 'zod', specifier: '^4.4.3' }],
      dependencies: { a: 'workspace:^', zod: 'catalog:peer' },
    });
  });

  it('leaves excluded dependencies alone in named mode', () => {
    expect(
      resolveDependencies(
        { ...options, catalogExcluded: ['dev:tsdown'], catalogs: 'named' },
        'devDependencies',
        { tsdown: '0.23.7' },
        undefined,
      ).dependencies,
    ).toEqual({ tsdown: '0.23.7' });
  });

  it('forwards our pin for an existing catalog reference without changing it', () => {
    expect(
      resolveDependencies(
        { ...options, catalogs: 'named' },
        'devDependencies',
        { typescript: 'catalog:dev' },
        { typescript: 'npm:@typescript/typescript6@6.0.2' },
      ),
    ).toEqual({
      catalogEntries: [
        {
          catalog: 'dev',
          dependency: 'typescript',
          specifier: 'npm:@typescript/typescript6@6.0.2',
        },
      ],
      dependencies: { typescript: 'catalog:dev' },
    });
  });

  it('only catalogs shared dependencies in default mode', () => {
    expect(
      resolveDependencies(
        { ...options, catalogShared: ['zod'], catalogs: 'default' },
        'dependencies',
        { slugify: '^1.6.9', zod: '^4.4.3' },
        undefined,
      ),
    ).toEqual({
      catalogEntries: [{ catalog: 'default', dependency: 'zod', specifier: '^4.4.3' }],
      dependencies: { slugify: '^1.6.9', zod: 'catalog:' },
    });
  });

  it('uses an overridden catalog field', () => {
    expect(
      resolveDependencies(
        { ...options, catalogs: 'named' },
        'dependencies',
        undefined,
        { tsdown: '^0.23.7' },
        'devDependencies',
      ).catalogEntries,
    ).toEqual([{ catalog: 'dev', dependency: 'tsdown', specifier: '^0.23.7' }]);
  });
});
