import type { IntakeDirectory } from 'bingo-fs';
import { describe, expect, it, vi } from 'vitest';

import {
  findNamedConflicts,
  findSharedDependencies,
  findWorkspacePackages,
  inferPackageKind,
  prepareRoot,
} from './prepareRoot.ts';

const json = (value: unknown): [string] => [JSON.stringify(value)];

const files: IntakeDirectory = {
  '.github': {
    workflows: {
      'ci.yml': ['name: CI'],
      'release.yml': ['client-id: ${{ vars.MY_BOT_CLIENT_ID }}'],
    },
  },
  '.nvmrc': ['26.13.1\n'],
  'README.md': ['<h1 align="center">My Repo</h1>'],
  'package.json': json({
    author: { email: 'a@b.c', name: 'Author' },
    description: 'A monorepo.',
    devDependencies: { tsdown: '0.23.7', typescript7: 'npm:typescript@7.0.2' },
    engines: { node: '>=22' },
    packageManager: 'pnpm@12.21.0',
    repository: { url: 'https://github.com/my-org/my-repo' },
  }),
  packages: {
    a: {
      'package.json': json({ name: 'a', peerDependencies: { zod: '^4.4.3' } }),
      'tsconfig.json': json({ compilerOptions: { isolatedDeclarations: true } }),
      'tsdown.config.ts': ['export default defineConfig({ ...base });'],
    },
    b: {
      'package.json': json({
        dependencies: { a: 'workspace:^' },
        devDependencies: { zod: '4.6.7' },
        name: 'b',
        scripts: { test: 'vitest' },
      }),
      'tsconfig.json': json({}),
      'tsdown.config.ts': ['export default defineConfig({ ...base });'],
    },
    build: {
      'package.json': json({ dependencies: { tsdown: '^0.23.7' }, name: '@my/build' }),
    },
    create: {
      bin: { 'index.js': [''] },
      'package.json': json({ bin: './bin/index.js', name: 'create' }),
    },
    site: {
      'astro.config.ts': [''],
      'package.json': json({ name: 'site', scripts: { build: 'astro build' } }),
    },
  },
  'pnpm-workspace.yaml': ['packages:\n  - packages/*\ncatalogs:\n  dev:\n    zod: 4.6.7\n'],
};

const context = (options = {}) => ({
  files,
  log: vi.fn(),
  options,
  take: vi.fn(),
});

describe(prepareRoot, () => {
  it('infers options from an existing repository', () => {
    expect(prepareRoot(context())).toEqual({
      author: 'Author',
      catalogExcluded: ['dev:tsdown'],
      catalogs: 'named',
      description: 'A monorepo.',
      email: 'a@b.c',
      node: '26.13.1',
      nodeEngines: '>=22',
      owner: 'my-org',
      packages: [
        {
          directory: 'packages/a',
          isolatedDeclarations: true,
          kind: 'library',
          name: 'a',
        },
        {
          directory: 'packages/b',
          kind: 'library',
          name: 'b',
          scripts: ['test'],
          workspaceDependencies: ['a'],
        },
        { directory: 'packages/build', kind: 'build', name: '@my/build' },
        { directory: 'packages/create', kind: 'bin-js', name: 'create' },
        { directory: 'packages/site', kind: 'site', name: 'site', scripts: ['build'] },
      ],
      pnpm: '12.21.0',
      releaseApp: 'MY_BOT',
      repository: 'my-repo',
      scope: '@my',
      taskRunner: 'none',
      title: 'My Repo',
      typescript7Alias: 'typescript7',
      workflowExtension: 'yml',
    });
  });

  it('prefers an explicitly provided catalog mode', () => {
    expect(prepareRoot(context({ catalogs: 'default' }))).toMatchObject({
      catalogs: 'default',
      catalogShared: [],
    });
  });

  it('only infers a default catalog mode in setup mode', () => {
    expect(prepareRoot({ ...context(), files: {} })).toEqual({ catalogs: 'default' });
  });
});

describe(findWorkspacePackages, () => {
  it('supports exact directories and ignores negations', () => {
    expect(
      findWorkspacePackages(files, ['packages/a', '!packages/b']).map((pkg) => pkg.directory),
    ).toEqual(['packages/a']);
  });
});

describe(inferPackageKind, () => {
  it('treats a package without tsdown config or bin as repo-owned', () => {
    expect(inferPackageKind({ directory: 'packages/x', files: {}, manifest: { name: 'x' } })).toBe(
      'repo-owned',
    );
  });
});

describe(findSharedDependencies, () => {
  it('finds dependencies two manifests declare with the same specifier', () => {
    expect(
      findSharedDependencies([
        { kind: 'library', manifest: { devDependencies: { a: '1.0.0', b: '1.0.0' } } },
        { kind: 'library', manifest: { devDependencies: { a: '1.0.0', b: '2.0.0' } } },
      ]),
    ).toEqual(['a']);
  });
});

describe(findNamedConflicts, () => {
  it('ignores differences CTM is about to resolve', () => {
    expect(
      findNamedConflicts([
        { kind: 'root', manifest: { devDependencies: { typescript: '6.0.3' } } },
        { kind: 'build', manifest: { dependencies: { typescript: '~6.0.3' } } } as never,
      ]),
    ).toEqual([]);
  });
});
