// cspell:ignore postbuild quandrix widgetco zentrix zorbix
import type { CreatedDirectory, IntakeDirectory } from 'bingo-fs';
import { describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';

import type { RootOptions } from '../options.ts';
import { prepareRoot } from '../prepare/prepareRoot.ts';
import { ownedFileMarker } from '../utils/files.ts';
import { isParseable } from '../utils/staticConfig.ts';
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
 * Writes a transition's files over the existing ones and lists the paths it changed.
 */
function applyFiles(files: IntakeDirectory, created: CreatedDirectory | undefined, prefix = '') {
  const changed: string[] = [];
  for (const [name, entry] of Object.entries(created ?? {})) {
    const path = `${prefix}${name}`;
    if (typeof entry === 'string') {
      if (getFile(files, path) !== entry) {
        changed.push(path);
        setFile(files, path, entry);
      }
    } else if (entry && !Array.isArray(entry)) {
      changed.push(...applyFiles(files, entry, `${path}/`));
    }
  }
  return changed;
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
          /actions\/create-github-app-token@\S+(?: # \S+)?/g,
          'actions/create-github-app-token@v4.0.0',
        )
        .replace(
          /actions\/checkout@\S+(?: # \S+)?/,
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
      config
        .replace(ownedFileMarker, `${ownedFileMarker}\n// @ts-check`)
        .replace(
          "import tseslint from 'typescript-eslint';",
          "import tseslint from 'typescript-eslint';\n\nconst scriptGlobs = ['scripts/**/*.ts'];",
        )
        .replace(
          /\);\n$/,
          "  { files: ['**/*.json'], rules: { 'jsonc/sort-keys': 'error' } },\n  { ignores: ['generated/**'] },\n  { files: scriptGlobs, rules: {} },\n);\n",
        ),
    );

    const output = getFile(transition(files).files, 'eslint.config.ts') ?? '';

    expect(output.startsWith(`${ownedFileMarker}\n\n// @ts-check`)).toBe(true);
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

  it('keeps scripts and dependency versions the repository has', () => {
    const files = createRepository();
    const manifest = JSON.parse(getFile(files, 'package.json') ?? '{}') as {
      devDependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    manifest.scripts.build = 'tsdown --filter=!website';
    manifest.devDependencies.eslint = '9.0.0';
    setFile(files, 'package.json', JSON.stringify(manifest, null, '\t'));

    const output = getFile(transition(files).files, 'package.json') ?? '';

    expect(output).toContain('"build": "tsdown --filter=!website"');
    expect(output).toContain('"eslint": "9.0.0"');
    expect(output).toContain('\t"name"');
  });

  it('leaves an existing nx.json alone', () => {
    const files = createRepository({ taskRunner: 'nx' });
    setFile(files, 'nx.json', JSON.stringify({ nxCloudId: 'abc' }, null, 2));

    expect(getFile(transition(files).files, 'nx.json')).toBeUndefined();
  });

  it('refuses a repository whose root is a published package', () => {
    const files = createRepository();
    const manifest = JSON.parse(getFile(files, 'package.json') ?? '{}') as Record<string, unknown>;
    delete manifest.private;
    manifest.main = './lib/index.js';
    setFile(files, 'package.json', JSON.stringify(manifest, null, 2));

    expect(() => transition(files)).toThrow(/root package.json is a published package/);
  });

  it('keeps Prettier and other Git hook tools a repository uses', () => {
    const files = createRepository();
    delete (files as Record<string, unknown>)['oxfmt.config.ts'];
    const manifest = JSON.parse(getFile(files, 'package.json') ?? '{}') as {
      devDependencies: Record<string, string>;
    };
    // A repository that never had CTM's formatter or hooks.
    for (const name of ['oxfmt', 'lint-staged', 'simple-git-hooks']) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete manifest.devDependencies[name];
    }
    manifest.devDependencies.prettier = '3.6.0';
    delete (manifest as { scripts?: Record<string, string> }).scripts?.format;
    manifest.devDependencies.husky = '9.1.7';
    setFile(files, 'package.json', JSON.stringify(manifest, null, 2));
    setFile(files, '.prettierrc.json', '{ "useTabs": true }\n');

    const creation = transition(files);

    expect(getFile(creation.files, 'oxfmt.config.ts')).toBeUndefined();
    const output = JSON.parse(getFile(creation.files, 'package.json') ?? '{}') as {
      devDependencies: Record<string, string>;
    };
    expect(output.devDependencies).not.toHaveProperty('oxfmt');
    expect(output.devDependencies).not.toHaveProperty('lint-staged');
    expect(JSON.stringify(creation.scripts)).toContain('prettier --ignore-unknown --write');
  });

  it('leaves owned files without the marker alone', () => {
    const files = createRepository();
    setFile(files, 'vitest.config.ts', 'export default { test: { testTimeout: 1 } };\n');

    const creation = transition(files);

    expect(getFile(creation.files, 'vitest.config.ts')).toBeUndefined();
    expect(creation.suggestions).toContainEqual(expect.stringContaining('vitest.config.ts'));
  });

  it("doesn't duplicate docs that exist under another case or location", () => {
    const files = createRepository();
    const github = files['.github'] as IntakeDirectory;
    delete github['PULL_REQUEST_TEMPLATE.md'];
    delete github['CONTRIBUTING.md'];
    delete github.ISSUE_TEMPLATE;
    delete (files as Record<string, unknown>)['LICENSE.md'];
    setFile(files, '.github/pull_request_template.md', 'Ours.\n');
    setFile(files, 'CONTRIBUTING.md', 'Ours.\n');
    setFile(files, '.github/ISSUE_TEMPLATE/bug.yml', 'name: Bug\n');
    setFile(files, 'LICENSE', 'Ours.\n');

    const output = transition(files).files;

    expect(getFile(output, '.github/PULL_REQUEST_TEMPLATE.md')).toBeUndefined();
    expect(getFile(output, '.github/CONTRIBUTING.md')).toBeUndefined();
    expect(getFile(output, '.github/ISSUE_TEMPLATE/01-bug.yaml')).toBeUndefined();
    expect(getFile(output, 'LICENSE.md')).toBeUndefined();
  });

  it('adds a workspace glob for a new build package that no glob covers', () => {
    const files = createRepository();
    delete (files.packages as IntakeDirectory).build;
    setFile(files, 'pnpm-workspace.yaml', "packages:\n  - 'packages/example'\n");

    expect(getFile(transition(files).files, 'pnpm-workspace.yaml')).toContain('packages/build');
  });

  it('writes a Node.js matrix for engines without full versions', () => {
    const files = createRepository({ nodeEngines: '>=22' });

    expect(getFile(files, '.github/workflows/ci.yaml')).toMatch(/node-version:\n\s+- 22\n/);
  });

  it.each([
    ["  '**/*.snap', /* generated by a script,\n     see scripts/gen.ts */\n", undefined],
    ["  ...gitignored, 'generated', // generated output\n", undefined],
    ["  'generated' // no comma\n", "  'generated', // no comma"],
  ])('keeps ESLint ignores as written: %j', (entries, expected) => {
    const files = createRepository();
    const config = (getFile(files, 'eslint.config.ts') ?? '').replace(
      /ignores: \[\n[^\]]*\]/,
      `ignores: [\n${entries}  ]`,
    );
    setFile(
      files,
      'eslint.config.ts',
      config.replace(
        "import tseslint from 'typescript-eslint';",
        "import tseslint from 'typescript-eslint';\n\nconst gitignored = ['dist'];",
      ),
    );

    const first = getFile(transition(files).files, 'eslint.config.ts') ?? '';
    setFile(files, 'eslint.config.ts', first);
    const second = getFile(transition(files).files, 'eslint.config.ts') ?? '';

    expect(first).toContain(expected ?? entries.trimEnd());
    expect(second).toBe(first);
    expect(isParseable(first)).toBe(true);
  });

  it('leaves an eslint.config.ts CTM did not create alone', () => {
    const files = createRepository();
    const config = (getFile(files, 'eslint.config.ts') ?? '').replace(`${ownedFileMarker}\n`, '');
    setFile(files, 'eslint.config.ts', config);

    const creation = transition(files);

    expect(getFile(creation.files, 'eslint.config.ts')).toBeUndefined();
    expect(creation.suggestions).toContainEqual(expect.stringContaining('eslint.config.ts'));
  });

  it("doesn't extend a build package a repository without libraries doesn't get", () => {
    const files = createRepository();
    const packages = files.packages as IntakeDirectory;
    delete packages.build;
    delete (packages.example as IntakeDirectory)['tsdown.config.ts'];
    delete (files as Record<string, unknown>)['tsconfig.json'];

    const tsconfig = getFile(transition(files).files, 'tsconfig.json') ?? '';

    expect(tsconfig).not.toContain('extends');
    expect(tsconfig).toContain('"moduleResolution": "NodeNext"');
  });

  it('reads ESLint ignores only from the config, not other objects in the file', () => {
    const files = createRepository();
    const config = (getFile(files, 'eslint.config.ts') ?? '')
      .replace("'**/*.snap',", "'**/*.snap',\n      'docs/generated',")
      .replace(
        "import tseslint from 'typescript-eslint';",
        "import tseslint from 'typescript-eslint';\n\nconst fixtureIgnores = { ignores: ['**/fixtures/**'] };",
      );
    setFile(files, 'eslint.config.ts', config);

    expect(getFile(transition(files).files, 'eslint.config.ts')).toContain("'docs/generated'");
  });

  it('finds the owned-file marker after imports are sorted above it', () => {
    const files = createRepository();
    const config = getFile(files, 'eslint.config.ts') ?? '';
    setFile(
      files,
      'eslint.config.ts',
      `import cspell from '@cspell/eslint-plugin/configs';\n${config}`,
    );

    expect(getFile(transition(files).files, 'eslint.config.ts')).toBeDefined();
  });

  it('gives a companion package the version of a cataloged core package', () => {
    const files = createRepository();
    const manifest = JSON.parse(getFile(files, 'package.json') ?? '{}') as {
      devDependencies: Record<string, string>;
    };
    manifest.devDependencies.vitest = 'catalog:';
    delete manifest.devDependencies['@vitest/coverage-v8'];
    setFile(files, 'package.json', JSON.stringify(manifest, null, 2));
    setFile(
      files,
      'pnpm-workspace.yaml',
      `${getFile(files, 'pnpm-workspace.yaml') ?? ''}catalog:\n  vitest: ^4.0.0\n`,
    );

    expect(getFile(transition(files).files, 'package.json')).toContain(
      '"@vitest/coverage-v8": "^4.0.0"',
    );
  });

  it('keeps matrix entries that engines.node still allows', () => {
    const files = createRepository({ nodeEngines: '>=20' });
    const ci = (getFile(files, '.github/workflows/ci.yaml') ?? '').replace(
      /node-version:\n(?:\s+- \S+\n)+/,
      'node-version:\n          - 20\n          - 22\n          - 24\n',
    );
    setFile(files, '.github/workflows/ci.yaml', ci);

    const output = getFile(
      transition(files, { nodeEngines: '>=20' }).files,
      '.github/workflows/ci.yaml',
    );

    expect(output).toMatch(/- 22\n\s+- 24/);
  });

  it('adds a .prettierignore in Prettier repositories', () => {
    const files = createRepository({ formatter: 'prettier' });

    expect(getFile(files, '.prettierignore')).toContain('pnpm-lock.yaml');
  });

  it('adds a missing repository to the root package.json', () => {
    const files = createRepository();
    const manifest = JSON.parse(getFile(files, 'package.json') ?? '{}') as Record<string, unknown>;
    delete manifest.repository;
    setFile(files, 'package.json', JSON.stringify(manifest, null, 2));

    expect(getFile(transition(files).files, 'package.json')).toContain(
      'https://github.com/example-org/example',
    );
  });

  it('keeps existing VS Code settings in place and appends missing ones', () => {
    const files = createRepository();
    setFile(
      files,
      '.vscode/settings.json',
      JSON.stringify({ 'z.custom': 1, 'editor.rulers': [80] }, null, 2),
    );

    const settings = JSON.parse(
      getFile(transition(files).files, '.vscode/settings.json') ?? '{}',
    ) as Record<string, unknown>;

    expect(Object.keys(settings).slice(0, 2)).toEqual(['z.custom', 'editor.rulers']);
    expect(settings['editor.rulers']).toEqual([80]);
  });

  it("doesn't add an engines check when a repository-owned package could fail it", () => {
    const files = createRepository();
    delete ((files['.github'] as IntakeDirectory).workflows as IntakeDirectory)['ci.yaml'];
    setFile(
      files,
      'packages/website/package.json',
      JSON.stringify({ name: 'website', private: true }),
    );

    expect(getFile(transition(files).files, '.github/workflows/ci.yaml')).not.toContain(
      'engines_check',
    );
  });

  it('ignores package build outputs when only root ones were ignored', () => {
    const files = createRepository();
    setFile(files, '.gitignore', 'node_modules\n/dist\n/lib\n');

    const gitignore = getFile(transition(files).files, '.gitignore') ?? '';

    expect(gitignore).toContain('\ndist/');
    expect(gitignore).toContain('\nlib/');
  });

  it("doesn't ignore a package named like a build output", () => {
    const gitignore = getFile(createRepository({ repository: 'lib' }), '.gitignore') ?? '';

    expect(gitignore).not.toMatch(/^lib\/$/m);
    expect(gitignore).toContain('packages/*/lib/');
  });

  it('adds a new package outside existing globs to the workspace', () => {
    const files = createRepository();
    setFile(
      files,
      'pnpm-workspace.yaml',
      "packages:\n  - 'packages/build'\n  - 'packages/example'\n",
    );

    expect(
      getFile(transition(files, { newPackage: 'second' }).files, 'pnpm-workspace.yaml'),
    ).toContain('packages/second');
  });

  it('gives new packages scripts when the root runs them recursively', () => {
    const files = createRepository();
    const manifest = JSON.parse(getFile(files, 'package.json') ?? '{}') as {
      scripts: Record<string, string>;
    };
    manifest.scripts.build = 'pnpm -r build';
    setFile(files, 'package.json', JSON.stringify(manifest, null, 2));

    expect(
      getFile(transition(files, { newPackage: 'second' }).files, 'packages/second/package.json'),
    ).toContain('"build": "tsdown"');
  });

  it('keeps a sorted package.json sorted when adding to it', () => {
    const files = createRepository();
    const manifest = JSON.parse(getFile(files, 'package.json') ?? '{}') as Record<string, unknown>;
    delete manifest.repository;
    (manifest.scripts as Record<string, string>) = { build: 'tsdown', test: 'vitest' };
    setFile(files, 'package.json', JSON.stringify(manifest, null, 2));

    const output = JSON.parse(getFile(transition(files).files, 'package.json') ?? '{}') as {
      scripts: Record<string, string>;
    };
    const keys = Object.keys(output);

    expect(keys.indexOf('repository')).toBeLessThan(keys.indexOf('license'));
    expect(Object.keys(output.scripts)).toEqual(Object.keys(output.scripts).sort());
  });

  it('keeps comments in the workspace packages list when adding a glob', () => {
    const files = createRepository();
    setFile(
      files,
      'pnpm-workspace.yaml',
      "packages:\n  # the example package\n  - 'packages/example' # inline\n  - 'packages/build'\n",
    );

    const output =
      getFile(transition(files, { newPackage: 'second' }).files, 'pnpm-workspace.yaml') ?? '';

    expect(output).toContain('# the example package');
    expect(output).toContain("- 'packages/example' # inline");
    expect(output).toContain('packages/second');
  });

  it('infers pnpm as the task runner from recursive test scripts, and per-package builds from recursive builds', () => {
    const read = (scripts: Record<string, string>) => {
      const files = createRepository();
      const manifest = JSON.parse(getFile(files, 'package.json') ?? '{}') as {
        scripts: Record<string, string>;
      };
      manifest.scripts = { ...manifest.scripts, ...scripts };
      setFile(files, 'package.json', JSON.stringify(manifest, null, 2));
      return prepareRoot({ files, log: vi.fn(), options: {}, take: vi.fn() as never });
    };

    for (const test of ['pnpm -r test', 'pnpm --parallel -r test', 'pnpm -F "./packages/*" test']) {
      expect(read({ test }).taskRunner).toBe('pnpm');
    }

    // CTM's own per-package build, for packages tsdown's workspace mode skips, stays as it is.
    const recursive = read({ build: 'pnpm --recursive --filter "./packages/*" run build' });
    expect(recursive.taskRunner).toBe('none');
    expect(recursive.recursiveBuild).toBe(true);
  });

  it("doesn't add Vitest to a repository that tests with something else", () => {
    const files = createRepository();
    delete (files as Record<string, unknown>)['vitest.config.ts'];
    const manifest = JSON.parse(getFile(files, 'package.json') ?? '{}') as {
      devDependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    manifest.scripts.test = 'node --test';
    delete manifest.devDependencies.vitest;
    delete manifest.devDependencies['@vitest/coverage-v8'];
    setFile(files, 'package.json', JSON.stringify(manifest, null, 2));

    const output = transition(files).files;

    expect(getFile(output, 'vitest.config.ts')).toBeUndefined();
    expect(getFile(output, 'package.json')).not.toContain('"vitest"');
  });

  it("doesn't add a root tsdown build when a package config would be skipped by it", () => {
    const files = createRepository();
    delete (files as Record<string, unknown>)['tsdown.config.ts'];
    setFile(
      files,
      'packages/example/tsdown.config.ts',
      'export default defineConfig({ dts: true });\n',
    );
    const rootManifest = JSON.parse(getFile(files, 'package.json') ?? '{}') as {
      scripts: Record<string, string>;
    };
    delete rootManifest.scripts.build;
    setFile(files, 'package.json', JSON.stringify(rootManifest, null, 2));

    const creation = transition(files);
    const scripts = (
      JSON.parse(getFile(creation.files, 'package.json') ?? '{}') as {
        scripts: Record<string, string>;
      }
    ).scripts;

    expect(getFile(creation.files, 'tsdown.config.ts')).toBeUndefined();
    expect(scripts.build).toMatch(/^pnpm --recursive .* run build$/);
    expect(getFile(creation.files, 'packages/example/package.json')).toContain('"build": "tsdown"');
    expect(creation.suggestions).toContainEqual(expect.stringContaining('packages/example'));
  });

  it('counts a turbo repository whose packages test with Vitest as using Vitest', () => {
    const files = createRepository();
    const manifest = JSON.parse(getFile(files, 'package.json') ?? '{}') as {
      devDependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    manifest.scripts.test = 'turbo run test';
    delete manifest.devDependencies.vitest;
    setFile(files, 'package.json', JSON.stringify(manifest, null, 2));
    const pkg = JSON.parse(getFile(files, 'packages/example/package.json') ?? '{}') as {
      scripts?: Record<string, string>;
    };
    pkg.scripts = { ...pkg.scripts, test: 'vitest run' };
    setFile(files, 'packages/example/package.json', JSON.stringify(pkg, null, 2));

    expect(
      prepareRoot({ files, log: vi.fn(), options: {}, take: vi.fn() as never }).testRunner,
    ).toBeUndefined();
  });

  it('gives a repository testing with something else no Vitest starter test or lint rules', () => {
    const files = createRepository();
    const manifest = JSON.parse(getFile(files, 'package.json') ?? '{}') as {
      devDependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    manifest.scripts.test = 'node --test';
    delete manifest.devDependencies.vitest;
    setFile(files, 'package.json', JSON.stringify(manifest, null, 2));
    delete (files as Record<string, unknown>)['eslint.config.ts'];

    const output = transition(files, { newPackage: 'second' }).files;

    expect(getFile(output, 'packages/second/src/greet.ts')).toBeDefined();
    expect(getFile(output, 'packages/second/src/greet.test.ts')).toBeUndefined();
    expect(getFile(output, 'eslint.config.ts')).not.toContain('vitest');
  });

  it('suggests updating an older root tsdown', () => {
    const files = createRepository();
    const manifest = JSON.parse(getFile(files, 'package.json') ?? '{}') as {
      devDependencies: Record<string, string>;
    };
    manifest.devDependencies.tsdown = '^0.15.0';
    setFile(files, 'package.json', JSON.stringify(manifest, null, 2));

    const creation = transition(files);

    expect(creation.suggestions).toContainEqual(expect.stringContaining('tsdown ^0.15.0'));
    expect(getFile(creation.files, 'package.json')).toContain('"tsdown": "^0.15.0"');
  });

  it("doesn't count a comment mentioning entry as a tsdown entry", () => {
    const files = createRepository();
    delete (files as Record<string, unknown>)['tsdown.config.ts'];
    setFile(
      files,
      'packages/example/tsdown.config.ts',
      "// tsdown's default entry is built.\nexport default defineConfig({ dts: true });\n",
    );

    expect(getFile(transition(files).files, 'tsdown.config.ts')).toBeUndefined();
  });

  it('judges .gitignore coverage the same whether or not outputs are built', () => {
    const clean = createRepository();
    setFile(clean, '.gitignore', 'node_modules\npackages/*/dist\npackages/*/lib\ncoverage\n');
    const built = createRepository();
    setFile(built, '.gitignore', 'node_modules\npackages/*/dist\npackages/*/lib\ncoverage\n');
    setFile(built, 'packages/example/dist/index.mjs', '');
    setFile(built, 'packages/example/lib/index.d.ts', '');

    const cleanOutput = getFile(transition(clean).files, '.gitignore');

    expect(cleanOutput).toBe('node_modules\npackages/*/dist\npackages/*/lib\ncoverage\n');
    expect(getFile(transition(built).files, '.gitignore')).toBe(cleanOutput);
  });

  it('makes no changes on a second transition after building packages per package', () => {
    const files = createRepository();
    delete (files as Record<string, unknown>)['tsdown.config.ts'];
    setFile(
      files,
      'packages/example/tsdown.config.ts',
      'export default defineConfig({ dts: true });\n',
    );
    const manifest = JSON.parse(getFile(files, 'package.json') ?? '{}') as {
      scripts: Record<string, string>;
    };
    delete manifest.scripts.build;
    setFile(files, 'package.json', JSON.stringify(manifest, null, 2));

    applyFiles(files, transition(files).files);

    expect(applyFiles(files, transition(files).files)).toEqual([]);
  });

  it('keeps --testRunner other on later transitions without the flag', () => {
    const files = createRepository({ testRunner: 'other' });

    expect(getFile(files, 'vitest.config.ts')).toBeUndefined();
    expect(applyFiles(files, transition(files).files)).toEqual([]);
    expect(getFile(files, 'vitest.config.ts')).toBeUndefined();
  });

  it('infers another test runner from packages when the root has no test script', () => {
    const files = createRepository();
    delete (files as Record<string, unknown>)['vitest.config.ts'];
    delete (files as Record<string, unknown>)['eslint.config.ts'];
    const manifest = JSON.parse(getFile(files, 'package.json') ?? '{}') as {
      devDependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    delete manifest.scripts.test;
    delete manifest.devDependencies.vitest;
    setFile(files, 'package.json', JSON.stringify(manifest, null, 2));
    const pkg = JSON.parse(getFile(files, 'packages/example/package.json') ?? '{}') as {
      scripts?: Record<string, string>;
    };
    pkg.scripts = { ...pkg.scripts, test: 'jest' };
    setFile(files, 'packages/example/package.json', JSON.stringify(pkg, null, 2));

    expect(
      prepareRoot({ files, log: vi.fn(), options: {}, take: vi.fn() as never }).testRunner,
    ).toBe('other');
  });

  it("drops Vitest lint rules from CTM's own ESLint config when a repository stops using Vitest", () => {
    const files = createRepository();
    const manifest = JSON.parse(getFile(files, 'package.json') ?? '{}') as {
      devDependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    manifest.scripts.test = 'node --test';
    delete manifest.devDependencies.vitest;
    setFile(files, 'package.json', JSON.stringify(manifest, null, 2));

    applyFiles(files, transition(files).files);

    expect(getFile(files, 'eslint.config.ts')).not.toContain('vitest');
    expect(applyFiles(files, transition(files).files)).toEqual([]);
  });

  it("doesn't suggest updating a root tsdown newer than CTM's", () => {
    const files = createRepository();
    const manifest = JSON.parse(getFile(files, 'package.json') ?? '{}') as {
      devDependencies: Record<string, string>;
    };
    manifest.devDependencies.tsdown = '0.99.0';
    setFile(files, 'package.json', JSON.stringify(manifest, null, 2));

    expect(transition(files).suggestions).not.toContainEqual(
      expect.stringContaining('tsdown 0.99.0'),
    );
  });

  it('gives a new package the homepage its sibling libraries share', () => {
    const files = createRepository();
    applyFiles(files, transition(files, { newPackage: 'second' }).files);
    for (const directory of ['example', 'second']) {
      setHomepage(files, `packages/${directory}`, 'https://example.dev');
    }

    const output = transition(files, { newPackage: 'third' }).files;

    expect(getFile(output, 'packages/third/package.json')).toContain(
      '"homepage": "https://example.dev"',
    );
  });

  it("doesn't copy a homepage from a single sibling or one naming a package", () => {
    const single = createRepository();
    setHomepage(single, 'packages/example', 'https://example.dev');

    // Each sibling having a homepage of its own gives the new package its GitHub directory.
    expect(
      getFile(transition(single, { newPackage: 'second' }).files, 'packages/second/package.json'),
    ).toContain(
      '"homepage": "https://github.com/example-org/example/tree/HEAD/packages/second#readme"',
    );

    const named = createRepository();
    applyFiles(named, transition(named, { newPackage: 'second' }).files);
    for (const directory of ['example', 'second']) {
      setHomepage(
        named,
        `packages/${directory}`,
        `https://github.com/example-org/example/tree/main/packages/${directory}#readme`,
      );
    }
    setHomepage(
      named,
      'packages/second',
      'https://github.com/example-org/example/tree/main/packages/example#readme',
    );

    expect(
      getFile(transition(named, { newPackage: 'third' }).files, 'packages/third/package.json'),
    ).toContain('/tree/HEAD/packages/third#readme');
  });

  it("keeps a repository's own entry for test files when it doesn't use Vitest", () => {
    const files = createRepository();
    const manifest = JSON.parse(getFile(files, 'package.json') ?? '{}') as {
      devDependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    manifest.scripts.test = 'jest';
    delete manifest.devDependencies.vitest;
    setFile(files, 'package.json', JSON.stringify(manifest, null, 2));
    const jestEntry = `{
    extends: [jest.configs['flat/recommended']],
    files: ['**/*.test.*'],
    rules: { 'jest/no-conditional-expect': 'off' },
    settings: { jest: { version: 30 } },
  }`;
    setFile(
      files,
      'eslint.config.ts',
      (getFile(files, 'eslint.config.ts') ?? '')
        .replace(
          "import vitest from '@vitest/eslint-plugin';",
          "import jest from 'eslint-plugin-jest';",
        )
        .replace(/\{\n {4}extends: \[vitest[\s\S]*?typecheck: true \} \},\n {2}\}/, jestEntry),
    );

    applyFiles(files, transition(files).files);
    const config = getFile(files, 'eslint.config.ts');

    expect(config).toContain(jestEntry);
    expect(config).toContain("import jest from 'eslint-plugin-jest';");
    expect(config).not.toContain('vitest');
    expect(applyFiles(files, transition(files).files)).toEqual([]);
  });

  it('gives a library in a top-level directory a Vitest project, and lints its configs', () => {
    const files = createRepository({ taskRunner: 'pnpm' });
    const example = (files.packages as IntakeDirectory).example as IntakeDirectory;
    files.tools = structuredClone(example);
    const pkg = JSON.parse(getFile(files, 'tools/package.json') ?? '{}') as Record<string, unknown>;
    pkg.name = 'tools';
    pkg.scripts = {};
    setFile(files, 'tools/package.json', JSON.stringify(pkg, null, 2));
    setFile(files, 'pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n  - tools\n");

    const output = transition(files).files;

    expect(getFile(output, 'tools/package.json')).toContain(
      'vitest run --config ../vitest.config.ts --project tools',
    );
    expect(getFile(output, 'vitest.config.ts')).toContain(".concat(['tools'])");
    expect(getFile(output, 'tsconfig.json')).toContain('./tools/*.config.ts');
    expect(getFile(output, 'eslint.config.ts')).toContain("'tools/dist'");
  });

  it("doesn't build packages per package when the root build only filters a site", () => {
    const files = createRepository();
    const manifest = JSON.parse(getFile(files, 'package.json') ?? '{}') as {
      scripts: Record<string, string>;
    };
    manifest.scripts.build = 'tsdown && pnpm --filter ./docs build';
    setFile(files, 'package.json', JSON.stringify(manifest, null, 2));

    expect(
      prepareRoot({ files, log: vi.fn(), options: {}, take: vi.fn() as never }).recursiveBuild,
    ).toBeUndefined();

    manifest.scripts.build = 'pnpm --filter "./packages/*" build';
    setFile(files, 'package.json', JSON.stringify(manifest, null, 2));

    expect(
      prepareRoot({ files, log: vi.fn(), options: {}, take: vi.fn() as never }).recursiveBuild,
    ).toBe(true);
  });

  it('keeps another test runner in a managed repository whose ESLint config it took over', () => {
    const files = createRepository({ testRunner: 'other' });
    setFile(
      files,
      'eslint.config.ts',
      (getFile(files, 'eslint.config.ts') ?? '').replace(ownedFileMarker, ''),
    );

    expect(
      prepareRoot({ files, log: vi.fn(), options: {}, take: vi.fn() as never }).testRunner,
    ).toBe('other');
  });
});

describe('round 11 regressions', () => {
  const setManifest = (
    files: IntakeDirectory,
    path: string,
    update: (manifest: Partial<Record<string, Record<string, string>>>) => void,
  ) => {
    const manifest = JSON.parse(getFile(files, path) ?? '{}') as Partial<
      Record<string, Record<string, string>>
    >;
    update(manifest);
    setFile(files, path, JSON.stringify(manifest, null, 2));
  };

  it('keeps the Vitest import an edited Vitest entry still uses without Vitest', () => {
    const files = createRepository();
    setFile(
      files,
      'eslint.config.ts',
      (getFile(files, 'eslint.config.ts') ?? '').replace(
        "'vitest/no-conditional-expect': 'off',",
        "'vitest/no-conditional-expect': 'off',\n      'vitest/expect-expect': 'off',",
      ),
    );
    setManifest(files, 'package.json', (manifest) => {
      manifest.scripts = { ...manifest.scripts, test: 'node --test' };
      delete manifest.devDependencies?.vitest;
    });

    applyFiles(files, transition(files).files);
    const config = getFile(files, 'eslint.config.ts') ?? '';

    expect(config).toContain("'vitest/expect-expect': 'off'");
    expect(config).toContain("import vitest from '@vitest/eslint-plugin';");
    expect(isParseable(config)).toBe(true);
    expect(applyFiles(files, transition(files).files)).toEqual([]);
  });

  it("doesn't count missing files as signs of a managed repository without tests", () => {
    const files = createRepository();
    delete (files as Record<string, unknown>)['vitest.config.ts'];
    delete (files as Record<string, unknown>)['knip.config.ts'];
    delete (files.packages as Record<string, unknown>).build;
    setFile(
      files,
      'eslint.config.ts',
      (getFile(files, 'eslint.config.ts') ?? '').replace(ownedFileMarker, ''),
    );
    setManifest(files, 'package.json', (manifest) => {
      delete manifest.scripts?.test;
      delete manifest.devDependencies?.vitest;
    });

    expect(
      prepareRoot({ files, log: vi.fn(), options: {}, take: vi.fn() as never }).testRunner,
    ).toBeUndefined();
  });

  it('names Vitest projects by path when folder names repeat across parents', () => {
    const files = createRepository({ taskRunner: 'pnpm' });
    const example = (files.packages as IntakeDirectory).example as IntakeDirectory;
    files.apps = { example: structuredClone(example) };
    setManifest(files, 'apps/example/package.json', (manifest) => {
      (manifest as Record<string, unknown>).name = 'app-example';
      delete (manifest as Record<string, unknown>).scripts;
    });
    setManifest(files, 'packages/example/package.json', (manifest) => {
      delete (manifest as Record<string, unknown>).scripts;
    });
    setFile(files, 'pnpm-workspace.yaml', "packages:\n  - 'apps/*'\n  - 'packages/*'\n");

    const output = transition(files).files;

    expect(getFile(output, 'apps/example/package.json')).toContain('--project apps/example');
    expect(getFile(output, 'packages/example/package.json')).toContain(
      '--project packages/example',
    );
    expect(getFile(output, 'vitest.config.ts')).toContain('folders.lastIndexOf');
  });

  it("guards a parent directory that doesn't exist in the Vitest config", () => {
    const output = produceMonorepo({
      mode: 'setup',
      options: {
        ...newRepository,
        packages: [{ directory: 'web', kind: 'library', name: 'web' }],
      },
    }).files;

    expect(getFile(output, 'vitest.config.ts')).toContain(
      'existsSync(path.join(import.meta.dirname, parent))',
    );
  });

  it("keeps another test runner's entry for test files when a repository starts using Vitest", () => {
    const files = createRepository({ testRunner: 'other' });
    const jestEntry = `{
    extends: [jest.configs['flat/recommended']],
    files: ['**/*.test.*'],
    rules: { 'jest/no-conditional-expect': 'off' },
    settings: { jest: { version: 30 } },
  }`;
    setFile(
      files,
      'eslint.config.ts',
      (getFile(files, 'eslint.config.ts') ?? '')
        .replace(
          "import tseslint from 'typescript-eslint';",
          "import jest from 'eslint-plugin-jest';\nimport tseslint from 'typescript-eslint';",
        )
        .replace(/\n\);\n$/, `\n  ${jestEntry},\n);\n`),
    );
    setManifest(files, 'package.json', (manifest) => {
      manifest.devDependencies = { ...manifest.devDependencies, vitest: '^5.0.0' };
    });

    const config = getFile(transition(files, { testRunner: 'vitest' }).files, 'eslint.config.ts');

    expect(config).toContain(jestEntry);
    expect(config).toContain('vitest.configs.recommended');
  });

  it('suggests deleting the Vitest config CTM no longer updates', () => {
    const files = createRepository();
    setManifest(files, 'package.json', (manifest) => {
      manifest.scripts = { ...manifest.scripts, test: 'node --test' };
      delete manifest.devDependencies?.vitest;
    });

    expect(transition(files).suggestions).toContainEqual(expect.stringContaining('delete it'));
  });

  it('shares a GitHub readme homepage that names the repository', () => {
    const files = createRepository();
    applyFiles(files, transition(files, { newPackage: 'second' }).files);
    for (const directory of ['example', 'second']) {
      setHomepage(files, `packages/${directory}`, 'https://github.com/example-org/example#readme');
    }

    expect(
      getFile(transition(files, { newPackage: 'third' }).files, 'packages/third/package.json'),
    ).toContain('"homepage": "https://github.com/example-org/example#readme"');
  });

  it.each([
    ['pnpm --filter ./docs build && pnpm -r build', true],
    ['pnpm --filter-prod ./docs build', undefined],
    ['pnpm --filter docs... build', true],
    ['pnpm --filter ./packages/example/ build', true],
    ['pnpm --filter ...docs build', undefined],
  ])('infers per-package builds from %s', (build, expected) => {
    const files = createRepository();
    setManifest(files, 'package.json', (manifest) => {
      manifest.scripts = { ...manifest.scripts, build };
    });

    expect(
      prepareRoot({ files, log: vi.fn(), options: {}, take: vi.fn() as never }).recursiveBuild,
    ).toBe(expected);
  });
});

describe('round 17 regressions', () => {
  const choicesText = '"create-typescript-monorepo-bingo": {';
  const editJson = (
    files: IntakeDirectory,
    path: string,
    edit: (json: Record<string, unknown>) => void,
  ) => {
    const json = JSON.parse(getFile(files, path) ?? '{}') as Record<string, unknown>;
    edit(json);
    setFile(files, path, JSON.stringify(json, null, 2));
  };

  it.each([{}, { formatter: 'prettier' }, { formatter: 'none' }, { testRunner: 'other' }] as const)(
    'remembers nothing for %o, which files show',
    (options) => {
      const files = createRepository(options);

      expect(getFile(files, 'package.json')).not.toContain(choicesText);
      expect(applyFiles(files, transition(files).files)).toEqual([]);
      applyFiles(files, transition(files, { newPackage: 'second' }).files);
      expect(applyFiles(files, transition(files).files)).toEqual([]);
      expect(getFile(files, 'package.json')).not.toContain(choicesText);
    },
  );

  it('follows a repository that moves to another formatter', () => {
    const files = createRepository({ formatter: 'prettier' });
    setFile(files, 'oxfmt.config.ts', 'export default {};\n');

    expect(
      prepareRoot({ files, log: vi.fn(), options: {}, take: vi.fn() as never }).formatter,
    ).not.toBe('prettier');
  });

  it('leaves ESLint out with --linter none', () => {
    const files = createRepository({ linter: 'none' });

    expect(getFile(files, 'eslint.config.ts')).toBeUndefined();
    expect(getFile(files, 'package.json')).not.toContain('eslint');
    expect(getFile(files, '.github/workflows/ci.yaml')).not.toContain('pnpm lint\n');
    expect(getFile(files, '.github/DEVELOPMENT.md')).not.toContain('eslint.org');
    expect(getFile(files, '.vscode/settings.json')).not.toContain('eslint');
  });

  it('opts an existing repository out of ESLint, keeps it out, and opts back in', () => {
    const files = createRepository();
    const config = getFile(files, 'eslint.config.ts');
    const creation = transition(files, { linter: 'none' });
    applyFiles(files, creation.files);

    expect(getFile(files, 'eslint.config.ts')).toBe(config);
    expect(creation.suggestions).toContainEqual(expect.stringContaining('ESLint is turned off'));

    delete (files as Record<string, unknown>)['eslint.config.ts'];
    expect(applyFiles(files, transition(files).files)).toEqual([]);

    applyFiles(files, transition(files, { linter: 'eslint' }).files);
    expect(getFile(files, 'eslint.config.ts')).toBeDefined();
    expect(getFile(files, 'package.json')).not.toContain(choicesText);
    expect(applyFiles(files, transition(files).files)).toEqual([]);
  });

  it('keeps --linter none from setup, and other values next to it', () => {
    const files = createRepository({ linter: 'none' });
    expect(getFile(files, 'package.json')).toContain(choicesText);
    editJson(files, 'package.json', (manifest) => {
      (manifest['create-typescript-monorepo-bingo'] as Record<string, string>).own = 'value';
    });

    expect(applyFiles(files, transition(files).files)).toEqual([]);
    applyFiles(files, transition(files, { linter: 'eslint' }).files);
    expect(getFile(files, 'package.json')).toContain('"own": "value"');
    expect(getFile(files, 'package.json')).not.toContain('"linter"');
  });

  it.each([
    [{ build: 'tsdown' }],
    [{}],
    [{ prebuild: 'a', build: 'tsdown', test: 'vitest' }],
    [{ build: 'tsdown', postbuild: 'b', test: 'vitest' }],
  ])('keeps scripts %o in lint order across transitions', (scripts) => {
    const files = createRepository();
    editJson(files, 'package.json', (manifest) => {
      manifest.scripts = scripts;
    });
    applyFiles(files, transition(files).files);

    expect(getFile(files, 'eslint.config.ts')).not.toContain('sort-collections');
    expect(applyFiles(files, transition(files).files)).toEqual([]);
  });

  it('keeps the lifecycle order of package scripts', () => {
    const files = createRepository({ taskRunner: 'turbo' });
    editJson(files, 'packages/example/package.json', (manifest) => {
      manifest.scripts = { prebuild: 'a', build: 'tsdown', postbuild: 'b' };
      delete manifest.engines;
    });
    applyFiles(files, transition(files).files);
    const manifest = JSON.parse(getFile(files, 'packages/example/package.json') ?? '{}') as {
      scripts: object;
    };

    expect(Object.keys(manifest.scripts)).toEqual(['prebuild', 'build', 'postbuild', 'test']);
    expect(applyFiles(files, transition(files).files)).toEqual([]);
  });

  it('keeps Vitest lint rules where packages test with Vitest without a root config', () => {
    const files = createRepository({ taskRunner: 'turbo' });
    delete (files as Record<string, unknown>)['vitest.config.ts'];
    editJson(files, 'package.json', (manifest) => {
      delete (manifest.devDependencies as Record<string, string>).vitest;
    });
    editJson(files, 'packages/example/package.json', (manifest) => {
      manifest.scripts = { build: 'tsdown', test: 'vitest run' };
      (manifest.devDependencies as Record<string, string>).vitest = '^5.0.0';
    });
    applyFiles(files, transition(files).files);

    expect(getFile(files, 'eslint.config.ts')).toContain('vitest.configs.recommended');
    expect(getFile(files, 'package.json')).toContain('@vitest/eslint-plugin');
    expect(applyFiles(files, transition(files).files)).toEqual([]);
  });

  it('lets Prettier win over Biome, unless told otherwise', () => {
    const files = createRepository({ formatter: 'prettier' });
    setFile(files, 'biome.json', '{}');
    editJson(files, 'package.json', (manifest) => {
      (manifest.devDependencies as Record<string, string>)['@biomejs/biome'] = '^2.0.0';
      (manifest.scripts as Record<string, string>)['lint:biome'] =
        'biome check --formatter-enabled=false .';
    });
    const infer = () =>
      prepareRoot({ files, log: vi.fn(), options: {}, take: vi.fn() as never }).formatter;

    expect(infer()).toBe('prettier');
    applyFiles(files, transition(files, { formatter: 'biome' }).files);
    expect(infer()).toBe('biome');
    expect(applyFiles(files, transition(files).files)).toEqual([]);
  });

  it("doesn't describe or turn on formatting without a formatter", () => {
    const files = createRepository({ formatter: 'none' });

    expect(getFile(files, '.github/DEVELOPMENT.md')).not.toContain('## Formatting');
    expect(getFile(files, '.vscode/settings.json')).not.toContain('formatOnSave');
  });

  it('remembers pnpm as the task runner next to a test script', () => {
    const files = createRepository();
    applyFiles(files, transition(files, { taskRunner: 'pnpm' }).files);

    expect(
      prepareRoot({ files, log: vi.fn(), options: {}, take: vi.fn() as never }).taskRunner,
    ).toBe('pnpm');
  });

  it('keeps TypeScript where tsconfigs use options TypeScript 7 removed', () => {
    const files = createRepository();
    editJson(files, 'package.json', (manifest) => {
      const devDependencies = manifest.devDependencies as Record<string, string>;
      devDependencies.typescript = '^6.0.2';
      delete devDependencies.typescript7;
    });
    editJson(files, 'packages/example/tsconfig.json', (tsconfig) => {
      tsconfig.compilerOptions = { baseUrl: '.', ignoreDeprecations: '6.0' };
    });
    delete (files.packages as Record<string, unknown>).build;
    const rootTSConfig = '{ "include": ["packages/*/src"] }\n';
    const settings = '{ "typescript.tsdk": "node_modules/typescript/lib" }\n';
    setFile(files, 'tsconfig.json', rootTSConfig);
    setFile(files, '.vscode/settings.json', settings);
    const creation = transition(files);
    applyFiles(files, creation.files);

    expect(getFile(files, 'package.json')).toContain('"typescript": "^6.0.2"');
    expect(getFile(files, 'package.json')).not.toContain('typescript7');
    expect(getFile(files, 'tsconfig.json')).toBe(rootTSConfig);
    expect(getFile(files, 'packages/build/package.json')).toBeUndefined();
    expect(getFile(files, '.vscode/settings.json')).toContain('node_modules/typescript/lib');
    expect(creation.suggestions).toContainEqual(expect.stringContaining('ignoreDeprecations'));
    expect(applyFiles(files, transition(files).files)).toEqual([]);
  });

  it("doesn't count ignoreDeprecations in fixtures or comments", () => {
    const files = createRepository();
    editJson(files, 'package.json', (manifest) => {
      const devDependencies = manifest.devDependencies as Record<string, string>;
      devDependencies.typescript = '^6.0.2';
      delete devDependencies.typescript7;
    });
    const tsconfig = '{ "compilerOptions": { "ignoreDeprecations": "6.0" } }';
    setFile(files, 'packages/example/test/fixture/tsconfig.json', tsconfig);
    setFile(files, 'tsconfig.other.json', '{\n  // "ignoreDeprecations": "6.0"\n}\n');

    expect(getFile(transition(files).files, 'package.json')).toContain('"typescript7"');
  });

  it("doesn't add CTM's Vitest rules next to a repository's own", () => {
    const files = createRepository({ testRunner: 'other' });
    setFile(
      files,
      'eslint.config.ts',
      (getFile(files, 'eslint.config.ts') ?? '').replace(
        "import tseslint from 'typescript-eslint';",
        "import tseslint from 'typescript-eslint';\nimport vitestPlugin from '@vitest/eslint-plugin';",
      ),
    );
    editJson(files, 'packages/example/package.json', (manifest) => {
      (manifest.devDependencies as Record<string, string>).vitest = '^5.0.0';
    });

    expect(getFile(transition(files).files, 'eslint.config.ts')).not.toContain(
      'vitest.configs.recommended',
    );
  });

  it("doesn't un-ignore a build package that isn't created", () => {
    const files: IntakeDirectory = {
      '.gitignore': ['node_modules\nbuild\n'],
      'package.json': ['{ "name": "root", "private": true }'],
      'pnpm-workspace.yaml': ["packages:\n  - 'apps/*'\n"],
      apps: { web: { 'package.json': ['{ "name": "web", "private": true }'] } },
    };

    expect(getFile(transition(files).files, '.gitignore')).not.toContain('!packages/build/');
  });
});

describe('round 16 regressions', () => {
  const editJson = (
    files: IntakeDirectory,
    path: string,
    edit: (json: Record<string, unknown>) => void,
  ) => {
    const json = JSON.parse(getFile(files, path) ?? '{}') as Record<string, unknown>;
    edit(json);
    setFile(files, path, JSON.stringify(json, null, 2));
  };
  const prepare = (files: IntakeDirectory) =>
    prepareRoot({ files, log: vi.fn(), options: {}, take: vi.fn() as never });
  const withoutFormatter = () => {
    const files = createRepository();
    delete (files as Record<string, unknown>)['oxfmt.config.ts'];
    editJson(files, 'package.json', (manifest) => {
      delete (manifest.devDependencies as Record<string, string>).oxfmt;
    });
    return files;
  };

  it('never formats files of a repository without a formatter CTM knows', () => {
    const files = withoutFormatter();
    const creation = transition(files);

    expect(prepare(files).formatter).toBe('none');
    expect(creation.scripts ?? []).not.toContainEqual(
      expect.objectContaining({ commands: [expect.stringContaining('oxfmt')] }),
    );
    expect(getFile(creation.files, 'oxfmt.config.ts')).toBeUndefined();
  });

  it.each([
    ['{ "json": { "formatter": { "enabled": false } } }', {}, 'biome'],
    ['{ "formatter": { "enabled": false } }', {}, 'none'],
    ['{}', { prettier: '^3.0.0' }, 'prettier'],
  ])('infers the formatter with biome.json %s and %o', (biome, dependencies, expected) => {
    const files = withoutFormatter();
    setFile(files, 'biome.json', biome);
    editJson(files, 'package.json', (manifest) => {
      manifest.devDependencies = { ...(manifest.devDependencies as object), ...dependencies };
    });

    expect(prepare(files).formatter).toBe(expected);
  });

  it.each(['vitest run', 'jest'])('leaves existing package tests running %s alone', (test) => {
    const files = createRepository({ taskRunner: 'turbo' });
    delete (files as Record<string, unknown>)['vitest.config.ts'];
    editJson(files, 'packages/example/package.json', (manifest) => {
      manifest.scripts = { test };
    });
    const creation = transition(files, { newPackage: 'second' });

    expect(prepare(files).testRunner).toBe('other');
    expect(getFile(creation.files, 'vitest.config.ts')).toBeUndefined();
    expect(getFile(creation.files, 'packages/second/package.json')).not.toContain('vitest');
    expect(getFile(creation.files, 'packages/second/src/greet.test.ts')).toBeUndefined();
  });

  it('leaves a root vitest run without a config alone', () => {
    const files = createRepository();
    delete (files as Record<string, unknown>)['vitest.config.ts'];
    editJson(files, 'package.json', (manifest) => {
      (manifest.scripts as Record<string, string>).test = 'vitest run';
    });

    expect(prepare(files).testRunner).toBe('other');
  });

  it('keeps packages/build out of an existing build/ ignore', () => {
    const files = createRepository();
    setFile(files, '.gitignore', 'node_modules\ndist\nlib\ncoverage\nbuild/\n');
    applyFiles(files, transition(files).files);

    expect(getFile(files, '.gitignore')).toContain('!packages/build/');
    expect(applyFiles(files, transition(files).files)).toEqual([]);
  });

  it("doesn't change the order existing recursive tests run in", () => {
    const files = createRepository();
    editJson(files, 'package.json', (manifest) => {
      (manifest.scripts as Record<string, string>).test = 'pnpm -r run test';
    });

    expect(getFile(transition(files).files, 'pnpm-workspace.yaml')).not.toContain('dependsOn');
  });

  it('replaces its earlier Vitest lint entry without keeping a copy', () => {
    const files = createRepository();
    setFile(
      files,
      'eslint.config.ts',
      (getFile(files, 'eslint.config.ts') ?? '').replace('**/*.test.{js,ts}', '**/*.test.*'),
    );
    const config = getFile(transition(files).files, 'eslint.config.ts') ?? '';

    expect(config.split('vitest.configs.recommended')).toHaveLength(2);
    expect(config).toContain("files: ['**/*.test.{js,ts}']");
  });

  it('pins an @eslint/js that exists next to a newer ESLint', () => {
    const files = createRepository();
    editJson(files, 'package.json', (manifest) => {
      const devDependencies = manifest.devDependencies as Record<string, string>;
      devDependencies.eslint = '^10.99.0';
      delete devDependencies['@eslint/js'];
    });

    expect(getFile(transition(files).files, 'package.json')).not.toContain(
      '"@eslint/js": "^10.99.0"',
    );
  });

  it('keeps sorted top-level keys sorted, whatever order nested ones are in', () => {
    const files = createRepository();
    editJson(files, 'package.json', (manifest) => {
      manifest.devDependencies = Object.fromEntries(
        Object.entries(manifest.devDependencies as object).reverse(),
      );
      delete manifest.packageManager;
      delete manifest.engines;
    });
    applyFiles(files, transition(files).files);

    expect(getFile(files, 'eslint.config.ts')).not.toContain('order-properties');
    expect(applyFiles(files, transition(files).files)).toEqual([]);
  });
});

describe('round 15 adoption regressions', () => {
  const editJson = (
    files: IntakeDirectory,
    path: string,
    edit: (json: Record<string, unknown>) => void,
  ) => {
    const json = JSON.parse(getFile(files, path) ?? '{}') as Record<string, unknown>;
    edit(json);
    setFile(files, path, JSON.stringify(json, null, 2));
  };

  it('turns off package.json order rules for unsorted manifests', () => {
    const files = createRepository();
    editJson(files, 'package.json', (manifest) => {
      manifest.scripts = { test: 'vitest', build: 'tsdown' };
    });

    const config = getFile(transition(files).files, 'eslint.config.ts');

    expect(config).not.toContain('order-properties');
    expect(config).toContain("'package-json/sort-collections': 'off'");
  });

  it("builds a site's workspace dependencies first", () => {
    const files = createRepository();
    setFile(
      files,
      'packages/site/package.json',
      JSON.stringify({
        dependencies: { astro: '^5.0.0' },
        name: 'site',
        scripts: { build: 'astro build' },
      }),
    );
    setFile(files, 'packages/site/astro.config.ts', 'export default {};\n');

    expect(getFile(transition(files).files, '.github/workflows/ci.yaml')).toContain(
      'pnpm --filter=site... build',
    );
  });

  it("suggests a root build that doesn't build tsdown packages include them", () => {
    const files = createRepository();
    editJson(files, 'package.json', (manifest) => {
      (manifest.scripts as Record<string, string>).build = 'tsc -b';
    });

    expect(transition(files).suggestions).toContainEqual(expect.stringContaining('`tsc -b`'));
  });
});

describe('round 15 regressions', () => {
  const editJson = (
    files: IntakeDirectory,
    path: string,
    edit: (json: Record<string, unknown>) => void,
  ) => {
    const json = JSON.parse(getFile(files, path) ?? '{}') as Record<string, unknown>;
    edit(json);
    setFile(files, path, JSON.stringify(json, null, 2));
  };

  it("keeps a repository's own package.json entry next to CTM's missing-fields entry", () => {
    const files = createRepository();
    const own = `{
    files: ['**/package.json'],
    rules: { 'package-json/require-engines': 'error' },
  }`;
    setFile(
      files,
      'eslint.config.ts',
      (getFile(files, 'eslint.config.ts') ?? '').replace(/\n\);\n$/, `\n  ${own},\n);\n`),
    );
    const originalManifest = getFile(files, 'packages/example/package.json') ?? '';
    editJson(files, 'packages/example/package.json', (manifest) => {
      delete manifest.sideEffects;
    });

    applyFiles(files, transition(files).files);
    const config = getFile(files, 'eslint.config.ts') ?? '';

    expect(config).toContain(own);
    expect(config).toContain("'package-json/require-sideEffects': 'off'");
    expect(applyFiles(files, transition(files).files)).toEqual([]);

    // Once the field is filled in, CTM's entry goes away and the repository's stays.
    setFile(files, 'packages/example/package.json', originalManifest);
    applyFiles(files, transition(files).files);

    expect(getFile(files, 'eslint.config.ts')).not.toContain('missing-package-fields');
    expect(getFile(files, 'eslint.config.ts')).toContain(own);
  });

  it('reads TypeScript and ESLint versions through catalogs and npm aliases', () => {
    const files = createRepository();
    delete (files as Record<string, unknown>)['eslint.config.ts'];
    editJson(files, 'package.json', (manifest) => {
      const devDependencies = manifest.devDependencies as Record<string, string>;
      devDependencies.typescript = 'npm:typescript@^5.9.3';
      devDependencies.eslint = 'catalog:';
      delete devDependencies.typescript7;
    });
    setFile(
      files,
      'pnpm-workspace.yaml',
      "packages:\n  - 'packages/*'\ncatalog:\n  eslint: ^8.57.0\n",
    );

    const creation = transition(files);

    expect(getFile(creation.files, 'package.json')).not.toContain('"typescript7"');
    expect(getFile(creation.files, 'eslint.config.ts')).toBeUndefined();
  });

  it('adds the ESM module pair only when the root tsconfig sets neither', () => {
    const files = createRepository();
    editJson(files, 'package.json', (manifest) => {
      delete manifest.type;
    });
    editJson(files, 'tsconfig.json', (tsconfig) => {
      tsconfig.compilerOptions = {
        ...(tsconfig.compilerOptions as object),
        module: 'NodeNext',
      };
    });

    const creation = transition(files);

    expect(getFile(creation.files, 'tsconfig.json')).not.toContain('bundler');
    expect(creation.suggestions).toContainEqual(expect.stringContaining('"module": "preserve"'));
  });

  it('formats with Prettier where Biome only lints', () => {
    const files = createRepository({ formatter: 'prettier' });
    setFile(files, 'biome.json', '{ "formatter": { "enabled": false } }\n');
    editJson(files, 'package.json', (manifest) => {
      (manifest.devDependencies as Record<string, string>)['@biomejs/biome'] = '^2.0.0';
    });

    expect(
      prepareRoot({ files, log: vi.fn(), options: {}, take: vi.fn() as never }).formatter,
    ).toBe('prettier');
  });

  it('refuses Biome as the formatter of a new repository', () => {
    expect(() => createRepository({ formatter: 'biome' })).toThrow('--formatter biome');
  });

  it('adds config globs when an include covers only some root config files', () => {
    const files = createRepository();
    setFile(files, 'tsconfig.json', '{ "include": ["eslint.config.ts", "scripts"] }\n');

    expect(getFile(transition(files).files, 'tsconfig.json')).toContain('"./*.config.ts"');
  });
});

describe('round 14 adoption regressions', () => {
  const editJson = (
    files: IntakeDirectory,
    path: string,
    edit: (json: Record<string, unknown>) => void,
  ) => {
    const json = JSON.parse(getFile(files, path) ?? '{}') as Record<string, unknown>;
    edit(json);
    setFile(files, path, JSON.stringify(json, null, 2));
  };
  const prepare = (files: IntakeDirectory) =>
    prepareRoot({ files, log: vi.fn(), options: {}, take: vi.fn() as never });

  it('leaves a root tsconfig.json that packages extend alone', () => {
    const files = createRepository();
    const rootTSConfig = '{ "compilerOptions": { "strict": true } }\n';
    setFile(files, 'tsconfig.json', rootTSConfig);
    setFile(files, 'packages/example/tsconfig.json', '{ "extends": "../../tsconfig.json" }\n');
    editJson(files, 'package.json', (manifest) => {
      delete (manifest.scripts as Record<string, string>).typecheck;
    });

    const creation = transition(files);

    expect(prepare(files).rootTSConfigExtended).toBe(true);
    expect(getFile(creation.files, 'tsconfig.json') ?? rootTSConfig).toBe(rootTSConfig);
    expect(getFile(creation.files, 'package.json')).not.toContain('"typecheck"');
  });

  it("leaves a package tsconfig that doesn't extend the build base alone", () => {
    const files = createRepository();
    const own = '{ "compilerOptions": { "strict": true }, "include": ["src", "test"] }\n';
    setFile(files, 'packages/example/tsconfig.json', own);

    expect(getFile(transition(files).files, 'packages/example/tsconfig.json') ?? own).toBe(own);
  });

  it("doesn't add the TypeScript 7 alias to a TypeScript 5 root", () => {
    const files = createRepository();
    editJson(files, 'package.json', (manifest) => {
      const devDependencies = manifest.devDependencies as Record<string, string>;
      devDependencies.typescript = '~5.9.3';
      delete devDependencies.typescript7;
    });

    const creation = transition(files);

    expect(getFile(creation.files, 'package.json')).not.toContain('"typescript7"');
    expect(creation.suggestions).toContainEqual(expect.stringContaining('older than 6'));
  });

  it('keeps an existing changesets config and only adds the changelog it uses', () => {
    const files = createRepository();
    const config = '{ "changelog": "@changesets/cli/changelog", "access": "public" }\n';
    setFile(files, '.changeset/config.json', config);
    editJson(files, 'package.json', (manifest) => {
      delete (manifest.devDependencies as Record<string, string>)['@changesets/changelog-github'];
    });

    const output = transition(files).files;

    expect(getFile(output, '.changeset/config.json')).not.toContain('privatePackages');
    expect(getFile(output, 'package.json')).not.toContain('@changesets/changelog-github');
  });

  it('formats with Biome in a repository that uses it', () => {
    const files = createRepository();
    delete (files as Record<string, unknown>)['oxfmt.config.ts'];
    setFile(files, 'biome.json', '{}\n');
    editJson(files, 'package.json', (manifest) => {
      const devDependencies = manifest.devDependencies as Record<string, string>;
      delete devDependencies.oxfmt;
      devDependencies['@biomejs/biome'] = '^2.0.0';
    });

    const creation = transition(files);

    expect(prepare(files).formatter).toBe('biome');
    expect(getFile(creation.files, 'oxfmt.config.ts')).toBeUndefined();
    expect(getFile(creation.files, 'eslint.config.ts')).not.toContain('sort-named-imports');
    expect(JSON.stringify(creation.scripts)).toContain('biome check --write');
  });

  it("checks root config files as ESM where the root isn't a module", () => {
    const files = createRepository();
    editJson(files, 'package.json', (manifest) => {
      delete manifest.type;
    });

    expect(getFile(transition(files).files, 'tsconfig.json')).toContain('"module": "preserve"');
  });

  it("doesn't set up ESLint for ESLint 8", () => {
    const files = createRepository();
    delete (files as Record<string, unknown>)['eslint.config.ts'];
    editJson(files, 'package.json', (manifest) => {
      (manifest.devDependencies as Record<string, string>).eslint = '^8.57.1';
    });

    const creation = transition(files);

    expect(getFile(creation.files, 'eslint.config.ts')).toBeUndefined();
    expect(creation.suggestions).toContainEqual(expect.stringContaining('ESLint ^8.57.1'));
  });

  it('turns off package.json rules for fields existing packages lack', () => {
    const files = createRepository();
    editJson(files, 'packages/example/package.json', (manifest) => {
      delete manifest.sideEffects;
    });

    const config = getFile(transition(files).files, 'eslint.config.ts');

    expect(config).toContain("'package-json/require-sideEffects': 'off'");
    expect(config).not.toContain("'package-json/require-type': 'off'");
  });

  it('keeps sorted root scripts sorted when adding to them', () => {
    const files = createRepository();
    editJson(files, 'package.json', (manifest) => {
      manifest.scripts = { build: 'tsdown', test: 'vitest' };
    });

    const scripts = Object.keys(
      (
        JSON.parse(getFile(transition(files).files, 'package.json') ?? '{}') as {
          scripts: Record<string, string>;
        }
      ).scripts,
    );

    expect(scripts).toEqual([...scripts].sort((a, b) => a.localeCompare(b)));
  });

  it("doesn't give a new package a sibling tsdown older than the build base needs", () => {
    const files = createRepository();
    editJson(files, 'packages/example/package.json', (manifest) => {
      (manifest.devDependencies as Record<string, string>).tsdown = '^0.15.0';
    });

    const creation = transition(files, { newPackage: 'second' });

    expect(getFile(creation.files, 'packages/second/package.json')).not.toContain('"tsdown"');
    expect(creation.suggestions).toContainEqual(expect.stringContaining('packages/example'));
  });

  it("doesn't repeat nx project.json targets as scripts", () => {
    const files = createRepository({ taskRunner: 'nx' });
    setFile(files, 'packages/example/project.json', '{ "targets": { "build": {}, "test": {} } }\n');
    editJson(files, 'packages/example/package.json', (manifest) => {
      delete manifest.scripts;
    });

    expect(getFile(transition(files).files, 'packages/example/package.json')).not.toContain(
      '"scripts"',
    );
  });

  it('suggests listing parents of packages deep globs match', () => {
    const files = createRepository();
    setFile(files, 'pnpm-workspace.yaml', "packages:\n  - 'packages/**'\n");

    expect(transition(files).suggestions).toContainEqual(expect.stringContaining('packages/**'));
  });
});

describe('round 14 regressions', () => {
  const editRoot = (files: IntakeDirectory, edit: (manifest: Record<string, unknown>) => void) => {
    const manifest = JSON.parse(getFile(files, 'package.json') ?? '{}') as Record<string, unknown>;
    edit(manifest);
    setFile(files, 'package.json', JSON.stringify(manifest, null, 2));
  };

  it("doesn't add the build package to an existing package that doesn't use it", () => {
    const files = createRepository();
    setFile(files, 'packages/example/tsconfig.json', '{ "extends": "../../tsconfig.base.json" }\n');
    setFile(
      files,
      'packages/example/tsdown.config.ts',
      "export default { entry: ['src/index.ts'] };\n",
    );
    const pkg = JSON.parse(getFile(files, 'packages/example/package.json') ?? '{}') as {
      devDependencies: Record<string, string>;
    };
    delete pkg.devDependencies['@example/build'];
    setFile(files, 'packages/example/package.json', JSON.stringify(pkg, null, 2));

    expect(getFile(transition(files).files, 'packages/example/package.json')).not.toContain(
      '@example/build',
    );
  });

  it('adds config globs an existing root include does not cover', () => {
    const files = createRepository();
    setFile(files, 'tsconfig.json', '{ "include": ["packages/*/src"] }\n');

    const tsconfig = getFile(transition(files).files, 'tsconfig.json');

    expect(tsconfig).toContain('"./*.config.ts"');
    expect(tsconfig).toContain('"./packages/*/*.config.ts"');

    setFile(files, 'tsconfig.json', '{ "include": ["**/*"] }\n');

    expect(getFile(transition(files).files, 'tsconfig.json')).not.toContain('*.config.ts');
  });

  it('suggests the Knip ignores a commented knip.config.ts is missing', () => {
    const files = createRepository();
    setFile(files, 'knip.config.ts', "// Our own.\nexport default { workspaces: { '.': {} } };\n");

    expect(transition(files).suggestions).toContainEqual(
      expect.stringContaining('@changesets/cli'),
    );
  });

  it('allows title words in spell checking for a new repository', () => {
    const files = createRepository({ title: 'Quandrix Toolkit' });

    expect(getFile(files, 'cspell.json')).toContain('"quandrix"');
  });

  it("doesn't count vue-tsc as running tsc", () => {
    const files = createRepository();
    editRoot(files, (manifest) => {
      (manifest.scripts as Record<string, string>).typecheck = 'vue-tsc --noEmit';
    });

    expect(getFile(transition(files).files, 'knip.config.ts')).toContain("'typescript7'");
  });

  it('fills in a missing root description', () => {
    const files = createRepository();
    editRoot(files, (manifest) => {
      delete manifest.description;
    });

    expect(getFile(transition(files).files, 'package.json')).toContain(
      '"description": "An example monorepo."',
    );
  });
});

describe('round 13 adoption regressions', () => {
  it('allows the owner and a new package name in spell checking', () => {
    const files = createRepository({ owner: 'widgetco' });

    expect(getFile(files, 'cspell.json')).toContain('"widgetco"');
    expect(getFile(transition(files, { newPackage: 'zorbix' }).files, 'cspell.json')).toContain(
      '"zorbix"',
    );
  });

  it('has Knip ignore the TypeScript 7 alias when no root script runs tsc', () => {
    const files = createRepository();
    const manifest = JSON.parse(getFile(files, 'package.json') ?? '{}') as {
      scripts: Record<string, string>;
    };
    manifest.scripts.typecheck = 'turbo run typecheck';
    setFile(files, 'package.json', JSON.stringify(manifest, null, 2));

    expect(getFile(transition(files).files, 'knip.config.ts')).toContain("'typescript7'");
  });

  it("doesn't give an existing package without a tsconfig one of its own", () => {
    const files = createRepository();
    delete ((files.packages as IntakeDirectory).example as Record<string, unknown>)[
      'tsconfig.json'
    ];

    expect(getFile(transition(files).files, 'packages/example/tsconfig.json')).toBeUndefined();
  });

  it('gives a new package the vitest devDependency packages CTM does not build declare', () => {
    const files = createRepository();
    for (const directory of ['one', 'two']) {
      setFile(
        files,
        `packages/${directory}/package.json`,
        JSON.stringify({ devDependencies: { vitest: 'catalog:' }, name: directory }, null, 2),
      );
    }

    expect(
      getFile(transition(files, { newPackage: 'probe' }).files, 'packages/probe/package.json'),
    ).toContain('"vitest": "catalog:"');
  });
});

describe('round 13 regressions', () => {
  it('has Knip ignore root build tools packages only use indirectly', () => {
    const files = createRepository({ taskRunner: 'turbo' });
    const pkg = JSON.parse(getFile(files, 'packages/example/package.json') ?? '{}') as {
      devDependencies: Record<string, string>;
    };
    pkg.devDependencies.tsdown = '^0.23.7';
    setFile(files, 'packages/example/package.json', JSON.stringify(pkg, null, 2));

    applyFiles(files, transition(files).files);
    const knip = getFile(files, 'knip.config.ts') ?? '';

    for (const dependency of ['@arethetypeswrong/core', 'publint', 'tsdown']) {
      expect(knip).toContain(`'${dependency}'`);
    }
    expect(applyFiles(files, transition(files).files)).toEqual([]);
  });

  it('keeps a test script pointing at a different Vitest config', () => {
    const files = createRepository({ taskRunner: 'turbo' });
    const pkg = JSON.parse(getFile(files, 'packages/example/package.json') ?? '{}') as {
      scripts: Record<string, string>;
    };
    pkg.scripts.test = 'vitest run --config ../vitest.config.ts --project unit';
    setFile(files, 'packages/example/package.json', JSON.stringify(pkg, null, 2));

    expect(getFile(transition(files).files, 'packages/example/package.json')).toContain(
      'vitest run --config ../vitest.config.ts --project unit',
    );
  });

  it('drops the Vitest import when kept code only declares or keys that name', () => {
    const files = createRepository();
    setFile(
      files,
      'eslint.config.ts',
      (getFile(files, 'eslint.config.ts') ?? '').replace(
        'export default defineConfig(',
        'class Settings {\n  vitest = 1;\n}\n\nexport const settings = new Settings();\n\nexport default defineConfig(',
      ),
    );

    const config = getFile(transition(files, { testRunner: 'other' }).files, 'eslint.config.ts');

    expect(config).toContain('vitest = 1;');
    expect(config).not.toContain('@vitest/eslint-plugin');
  });
});

describe('round 12 regressions', () => {
  it('gives a new package the tsdown and vitest devDependencies most siblings declare', () => {
    const files = createRepository();
    applyFiles(files, transition(files, { newPackage: 'second' }).files);
    for (const directory of ['example', 'second']) {
      const pkg = JSON.parse(getFile(files, `packages/${directory}/package.json`) ?? '{}') as {
        devDependencies: Record<string, string>;
      };
      pkg.devDependencies.tsdown = 'catalog:dev';
      pkg.devDependencies.vitest = 'catalog:dev';
      setFile(files, `packages/${directory}/package.json`, JSON.stringify(pkg, null, 2));
    }

    const third = getFile(
      transition(files, { newPackage: 'third' }).files,
      'packages/third/package.json',
    );

    expect(third).toContain('"tsdown": "catalog:dev"');
    expect(third).toContain('"vitest": "catalog:dev"');
  });

  it('writes the template name as code in generated markdown', () => {
    const files = createRepository();

    expect(getFile(files, 'packages/build/README.md')).toContain(
      '[`create-typescript-monorepo-bingo`](',
    );
  });

  it('renames Vitest projects in package test scripts as folder names start repeating', () => {
    const files = createRepository({
      packages: [
        { description: 'A CLI.', directory: 'apps/cli', kind: 'library', name: 'app-cli' },
        { description: 'A core.', directory: 'packages/core', kind: 'library', name: 'core' },
      ],
      taskRunner: 'turbo',
    });

    expect(getFile(files, 'apps/cli/package.json')).toContain('--project cli"');

    applyFiles(files, transition(files, { newPackage: 'cli' }).files);

    expect(getFile(files, 'apps/cli/package.json')).toContain('--project apps/cli"');
    expect(getFile(files, 'packages/cli/package.json')).toContain('--project packages/cli"');
    expect(applyFiles(files, transition(files).files)).toEqual([]);
  });

  it("keeps a package's own test script that only looks like a Vitest one", () => {
    const files = createRepository({ taskRunner: 'turbo' });
    const pkg = JSON.parse(getFile(files, 'packages/example/package.json') ?? '{}') as {
      scripts: Record<string, string>;
    };
    pkg.scripts.test = 'vitest run --project example --coverage';
    setFile(files, 'packages/example/package.json', JSON.stringify(pkg, null, 2));

    expect(getFile(transition(files).files, 'packages/example/package.json')).toContain(
      'vitest run --project example --coverage',
    );
  });

  it('drops the Vitest import when only strings or comments mention it', () => {
    const files = createRepository();
    setFile(
      files,
      'eslint.config.ts',
      (getFile(files, 'eslint.config.ts') ?? '').replace(
        /\n\);\n$/,
        "\n  // Not linted: vitest.config.ts\n  { ignores: ['vitest.config.ts'] },\n);\n",
      ),
    );

    const config = getFile(transition(files, { testRunner: 'other' }).files, 'eslint.config.ts');

    expect(config).toContain("{ ignores: ['vitest.config.ts'] }");
    expect(config).not.toContain('@vitest/eslint-plugin');
  });
});

describe('round 11 adoption regressions', () => {
  it('references the build package from a new package', () => {
    const files = createRepository();
    const output = transition(files, { newPackage: 'second' }).files;

    expect(getFile(output, 'packages/second/tsconfig.json')).toContain('"path": "../build"');
    // Existing packages keep their own references.
    expect(getFile(output, 'packages/example/tsconfig.json')).toBe(
      getFile(files, 'packages/example/tsconfig.json'),
    );
  });

  it("doesn't add a root tsdown config or build dependency a repository's own build doesn't use", () => {
    const files = createRepository();
    delete (files as Record<string, unknown>)['tsdown.config.ts'];
    setFile(
      files,
      'tsconfig.json',
      '{ "files": [], "references": [{ "path": "packages/example" }] }\n',
    );
    const manifest = JSON.parse(getFile(files, 'package.json') ?? '{}') as {
      devDependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    manifest.scripts.build = 'nx run-many -t build';
    delete manifest.devDependencies['@example/build'];
    setFile(files, 'package.json', JSON.stringify(manifest, null, 2));

    const output = transition(files, { newPackage: 'second' }).files;

    expect(getFile(output, 'tsdown.config.ts')).toBeUndefined();
    expect(getFile(output, 'package.json')).not.toContain('"@example/build"');
  });

  it("doesn't use contributors as the author", () => {
    const files = createRepository({ author: undefined });
    const manifest = JSON.parse(getFile(files, 'package.json') ?? '{}') as Record<string, unknown>;
    delete manifest.author;
    manifest.contributors = [{ email: 'someone@example.com', name: 'Some One' }];
    setFile(files, 'package.json', JSON.stringify(manifest, null, 2));

    expect(prepareRoot({ files, log: vi.fn(), options: {}, take: vi.fn() as never }).author).toBe(
      undefined,
    );
  });

  it("doesn't add a typecheck job a matrix step already runs", () => {
    const files = createRepository();
    setFile(
      files,
      '.github/workflows/ci.yaml',
      `name: CI
on: { pull_request: ~ }
jobs:
  checks:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        task: [build, typecheck]
    steps:
      - uses: actions/checkout@v6
      - run: pnpm \${{ matrix.task }}
`,
    );

    const workflow = getFile(transition(files).files, '.github/workflows/ci.yaml') ?? '';

    expect(workflow).not.toContain('type_check:');
    expect(workflow).not.toContain('\n  build:');
  });
});

function setHomepage(files: IntakeDirectory, directory: string, homepage: string) {
  const pkg = JSON.parse(getFile(files, `${directory}/package.json`) ?? '{}') as Record<
    string,
    unknown
  >;
  pkg.homepage = homepage;
  setFile(files, `${directory}/package.json`, JSON.stringify(pkg, null, 2));
}
