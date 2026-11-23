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

  it('keeps trigger settings that CTM writes as empty', () => {
    const files = createRepository();
    const ci = getFile(files, '.github/workflows/ci.yaml') ?? '';
    setFile(
      files,
      '.github/workflows/ci.yaml',
      ci.replace('pull_request: ~', "pull_request:\n    paths-ignore:\n      - 'docs/**'"),
    );

    expect(getFile(transition(files).files, '.github/workflows/ci.yaml')).toContain(
      "paths-ignore:\n      - 'docs/**'",
    );
  });

  it('keeps triggers written as a list', () => {
    const files = createRepository();
    const ci = getFile(files, '.github/workflows/ci.yaml') ?? '';
    setFile(
      files,
      '.github/workflows/ci.yaml',
      ci.replace(/on:\n(?: {2}.*\n)+/, 'on: [pull_request, push, merge_group]\n'),
    );

    expect(getFile(transition(files).files, '.github/workflows/ci.yaml')).toContain('merge_group');
  });

  it('keeps newer and SHA-pinned action versions', () => {
    const files = createRepository();
    const release = getFile(files, '.github/workflows/release.yaml') ?? '';
    setFile(
      files,
      '.github/workflows/release.yaml',
      release
        .replaceAll(
          'actions/create-github-app-token@v3.3.0',
          'actions/create-github-app-token@v4.0.0',
        )
        .replace(
          'actions/checkout@v7.0.1',
          'actions/checkout@0123456789abcdef0123456789abcdef01234567 # v7.0.2',
        ),
    );

    const output = getFile(transition(files).files, '.github/workflows/release.yaml');

    expect(output).toContain('actions/create-github-app-token@v4.0.0');
    expect(output).toContain('actions/checkout@0123456789abcdef0123456789abcdef01234567 # v7.0.2');
  });

  it('keeps a hand-edited schedule and follows engines in matrices', () => {
    const files = createRepository();
    const transitions = getFile(files, '.github/workflows/transitions.yaml') ?? '';
    setFile(
      files,
      '.github/workflows/transitions.yaml',
      transitions
        .replace("cron: '0 6 * * 1'", "cron: '0 3 1 * *'")
        .replace('cron: 0 6 * * 1', "cron: '0 3 1 * *'"),
    );

    const output = transition(files, { nodeEngines: '>=24.15.0' }).files;

    expect(getFile(output, '.github/workflows/transitions.yaml')).not.toContain('0 6 * * 1');
    expect(getFile(output, '.github/workflows/ci.yaml')).not.toContain('22.22.2');
  });

  it('keeps comments inside JSONC arrays when adding items', () => {
    const files = createRepository();
    setFile(
      files,
      '.vscode/extensions.json',
      `{
  "recommendations": [
    // our team's spell checker
    "streetsidesoftware.code-spell-checker",
  ],
}
`,
    );

    const output = getFile(transition(files).files, '.vscode/extensions.json');

    expect(output).toContain("// our team's spell checker");
    expect(output).toContain('dbaeumer.vscode-eslint');
  });

  it('keeps ESLint entries that look like CTM entries, and what extra entries use', () => {
    const files = createRepository();
    const config = getFile(files, 'eslint.config.ts') ?? '';
    setFile(
      files,
      'eslint.config.ts',
      `// @ts-check\n${config
        .replace(
          "import tseslint from 'typescript-eslint';",
          "import tseslint from 'typescript-eslint';\n\nconst scriptGlobs = ['scripts/**/*.ts'];",
        )
        .replace(
          /\);\n$/,
          "  { files: ['**/*.json'], rules: { 'jsonc/sort-keys': 'error' } },\n  { ignores: ['generated/**'] },\n  { files: scriptGlobs, rules: {} },\n);\n",
        )}`,
    );

    const output = getFile(transition(files).files, 'eslint.config.ts') ?? '';

    expect(output.startsWith('// @ts-check')).toBe(true);
    expect(output).toContain("const scriptGlobs = ['scripts/**/*.ts'];");
    expect(output).toContain("rules: { 'jsonc/sort-keys': 'error' }");
    expect(output).toContain("{ ignores: ['generated/**'] }");
    expect(output).toContain('{ files: scriptGlobs, rules: {} }');
  });

  it('keeps entries of an ESLint config exported through a variable', () => {
    const files = createRepository();
    const config = getFile(files, 'eslint.config.ts') ?? '';
    setFile(
      files,
      'eslint.config.ts',
      config
        .replace('export default defineConfig(', 'const config = defineConfig(')
        .replace(
          /\);\n$/,
          "  { rules: { 'no-console': 'error' } },\n);\n\nexport default config;\n",
        ),
    );

    expect(getFile(transition(files).files, 'eslint.config.ts')).toContain("'no-console': 'error'");
  });

  it('writes the default catalog where it already is', () => {
    const files = createRepository({ catalogs: 'default' });
    const workspace = getFile(files, 'pnpm-workspace.yaml') ?? '';
    setFile(
      files,
      'pnpm-workspace.yaml',
      workspace
        .replace('catalog:\n', 'catalogs:\n  default:\n')
        .replaceAll(/^ {2}('@types|tsdown|typescript)/gm, '    $1'),
    );

    const output = getFile(transition(files).files, 'pnpm-workspace.yaml') ?? '';

    expect(output).not.toMatch(/^catalog:/m);
    expect(output).not.toContain('dev:');
  });

  it('leaves alternate config files alone instead of adding competing ones', () => {
    const files = createRepository();
    const configs = files as Record<string, unknown>;
    delete configs['eslint.config.ts'];
    delete (configs['.github'] as Record<string, unknown>)['renovate.json'];
    setFile(files, 'eslint.config.mjs', 'export default [];\n');
    setFile(files, '.github/renovate.json5', '{ automerge: false }\n');

    const creation = transition(files);

    expect(getFile(creation.files, 'eslint.config.ts')).toBeUndefined();
    expect(getFile(creation.files, '.github/renovate.json')).toBeUndefined();
    expect(creation.suggestions).toContainEqual(expect.stringContaining('eslint.config.mjs'));
  });
});
