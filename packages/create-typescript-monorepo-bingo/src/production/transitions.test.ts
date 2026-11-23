import type { CreatedDirectory, IntakeDirectory } from 'bingo-fs';
import { describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';

import type { RootOptions } from '../options.ts';
import { prepareRoot } from '../prepare/prepareRoot.ts';
import { produceMonorepo } from './produceMonorepo.ts';

const newRepository = {
  author: 'Ex Ample',
  description: 'An example monorepo.',
  owner: 'example-org',
  repository: 'example',
  title: 'Example',
} satisfies RootOptions;

function toIntake(directory: CreatedDirectory): IntakeDirectory {
  return Object.fromEntries(
    Object.entries(directory).flatMap(([name, entry]) => {
      if (entry === undefined || entry === false) {
        return [];
      }

      if (typeof entry === 'string') {
        return [[name, [entry]]];
      }

      return [[name, Array.isArray(entry) ? entry : toIntake(entry)]];
    }),
  );
}

function getFile(directory: CreatedDirectory | IntakeDirectory | undefined, filePath: string) {
  let current: unknown = directory;
  for (const segment of filePath.split('/')) {
    current = (current as Record<string, unknown> | undefined)?.[segment];
  }

  return Array.isArray(current) ? (current[0] as string) : (current as string | undefined);
}

function setFile(directory: IntakeDirectory, filePath: string, contents: string) {
  const segments = filePath.split('/');
  const fileName = segments.pop() ?? filePath;
  let current = directory;
  for (const segment of segments) {
    current = (current[segment] ??= {}) as IntakeDirectory;
  }
  current[fileName] = [contents];
}

/**
 * Creates a new repository's files, as they'd be on disk.
 */
function createRepository(options: Partial<RootOptions> = {}) {
  return toIntake(
    produceMonorepo({ mode: 'setup', options: { ...newRepository, ...options } }).files ?? {},
  );
}

/**
 * Transitions files the way the CLI does: options are prepared from them first.
 */
function transition(files: IntakeDirectory, options: Partial<RootOptions> = {}) {
  const prepared = prepareRoot({ files, log: vi.fn(), options, take: vi.fn() as never });
  return produceMonorepo({
    files,
    mode: 'transition',
    options: { ...newRepository, ...prepared, ...options },
  });
}

describe('transitions of existing files', () => {
  it('keeps comments and custom options in a JSONC tsconfig', () => {
    const files = createRepository();
    setFile(
      files,
      'packages/example/tsconfig.json',
      `{
  // Keep strict JSX settings
  "extends": "@example/build/tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "outDir": "lib",
  },
  "include": ["src"],
}
`,
    );

    const tsconfig = getFile(transition(files).files, 'packages/example/tsconfig.json');

    expect(tsconfig).toContain('// Keep strict JSX settings');
    expect(tsconfig).toContain('"jsx": "react-jsx"');
  });

  it('throws rather than wiping a JSON file it cannot parse', () => {
    const files = createRepository();
    setFile(files, '.vscode/settings.json', '{ "editor.rulers": [100');

    expect(() => transition(files)).toThrow(/Could not parse/);
  });

  it('keeps a string repository in a package manifest', () => {
    const files = createRepository();
    const manifest = JSON.parse(getFile(files, 'packages/example/package.json') ?? '{}') as {
      repository: unknown;
    };
    manifest.repository = 'github:example-org/example';
    setFile(files, 'packages/example/package.json', JSON.stringify(manifest, null, 2));

    const output = JSON.parse(
      getFile(transition(files).files, 'packages/example/package.json') ?? '{}',
    ) as { repository: unknown };

    expect(output.repository).toEqual({
      directory: 'packages/example',
      type: 'git',
      url: 'github:example-org/example',
    });
  });

  it('keeps user config entries and imports in eslint.config.ts', () => {
    const files = createRepository();
    const config = getFile(files, 'eslint.config.ts') ?? '';
    setFile(
      files,
      'eslint.config.ts',
      config
        .replace(
          "import tseslint from 'typescript-eslint';",
          "import tseslint from 'typescript-eslint';\nimport custom from 'eslint-plugin-custom';",
        )
        .replace(
          /\);\n$/,
          "  // Custom rules\n  { rules: { 'no-console': 'error' } },\n  custom.configs.recommended,\n);\n",
        ),
    );

    const output = getFile(transition(files).files, 'eslint.config.ts');

    expect(output).toContain("import custom from 'eslint-plugin-custom';");
    expect(output).toContain("// Custom rules\n  { rules: { 'no-console': 'error' } },");
    expect(output).toContain('custom.configs.recommended,');
  });

  it('keeps a Knip config it cannot read statically', () => {
    const files = createRepository();
    const knip = `import type { KnipConfig } from 'knip';

const config: KnipConfig = { ignore: process.env.CI ? [] : ['tmp/**'] };

export default config;
`;
    setFile(files, 'knip.config.ts', knip);

    expect(getFile(transition(files).files, 'knip.config.ts')).toBe(knip);
  });

  it('keeps hand-added keys in workflows', () => {
    const files = createRepository();
    const ci = getFile(files, '.github/workflows/ci.yaml') ?? '';
    setFile(files, '.github/workflows/ci.yaml', `concurrency: ci\n\n${ci}`);

    expect(getFile(transition(files).files, '.github/workflows/ci.yaml')).toContain(
      'concurrency: ci',
    );
  });

  it('keeps the workflow extension when a differently named workflow is added', () => {
    const files = createRepository();
    setFile(files, '.github/workflows/deploy.yml', 'name: Deploy\n');

    const workflows = Object.keys(
      (transition(files).files?.['.github'] as CreatedDirectory).workflows as CreatedDirectory,
    );

    expect(workflows.filter((name) => name.endsWith('.yml'))).toEqual([]);
  });

  it("doesn't add a starter package to an existing repository without libraries", () => {
    const files = createRepository();
    delete (files.packages as IntakeDirectory).example;

    expect(getFile(transition(files).files, 'packages/example/package.json')).toBeUndefined();
  });

  it('leaves packages excluded by a negated workspace glob alone', () => {
    const files = createRepository();
    setFile(files, 'pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n  - '!packages/example'\n");

    expect(getFile(transition(files).files, 'packages/example/package.json')).toBeUndefined();
  });

  it('refuses a new package whose directory is taken', () => {
    const files = createRepository();

    expect(() => transition(files, { newPackage: '@other/example' })).toThrow(
      /packages\/example already holds example/,
    );
  });

  it('refuses an invalid new package name', () => {
    expect(() => transition(createRepository(), { newPackage: '../evil' })).toThrow(
      /isn't a valid npm package name/,
    );
  });

  it('never downgrades a catalog entry for a conflicting literal', () => {
    const files = createRepository({ catalogs: 'named' });
    const manifest = JSON.parse(getFile(files, 'packages/example/package.json') ?? '{}') as {
      devDependencies: Record<string, string>;
    };
    manifest.devDependencies.typescript = '^5.0.0';
    setFile(files, 'packages/example/package.json', JSON.stringify(manifest, null, 2));

    const first = transition(files);
    const workspace = parseYaml(getFile(first.files, 'pnpm-workspace.yaml') ?? '') as {
      catalogs: { dev: Record<string, string> };
    };

    expect(workspace.catalogs.dev.typescript).toBe('npm:@typescript/typescript6@6.0.2');
    expect(getFile(first.files, 'packages/example/package.json')).toContain(
      '"typescript": "^5.0.0"',
    );
    expect(first.suggestions).toContainEqual(expect.stringContaining('typescript'));
  });

  it('catalogs shared dependencies of a new repository in default mode', () => {
    const files = createRepository({ catalogs: 'default' });

    expect(getFile(files, 'pnpm-workspace.yaml')).toContain("'@types/node':");
    expect(getFile(files, 'packages/example/package.json')).toContain('"@types/node": "catalog:"');
  });
});
