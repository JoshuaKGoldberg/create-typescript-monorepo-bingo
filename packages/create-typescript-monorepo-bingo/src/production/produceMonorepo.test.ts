import pinsPackage from '@ctm/pins/package.json' with { type: 'json' };
import type { CreatedDirectory, IntakeDirectory } from 'bingo-fs';
import { producePreset } from 'bingo-stratum';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import type { RootOptions } from '../options.ts';
import { packagePreset, rootPreset } from '../presets.ts';
import { normalizeOptions, produceMonorepo } from './produceMonorepo.ts';

const options = {
  author: 'Ex Ample',
  description: 'An example monorepo.',
  email: 'ex@example.com',
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

function readFile(directory: CreatedDirectory | undefined, filePath: string): string {
  let current: unknown = directory;
  for (const segment of filePath.split('/')) {
    current = (current as Record<string, unknown> | undefined)?.[segment];
  }

  if (typeof current !== 'string') {
    throw new Error(`Missing file: ${filePath}`);
  }

  return current;
}

function listFiles(directory: CreatedDirectory, prefix = ''): string[] {
  return Object.entries(directory).flatMap(([name, entry]) =>
    entry && typeof entry === 'object' && !Array.isArray(entry)
      ? listFiles(entry, `${prefix}${name}/`)
      : [`${prefix}${name}`],
  );
}

describe(normalizeOptions, () => {
  it('adds a first package named after the repository, and a build package', () => {
    expect(normalizeOptions(options).packages).toEqual([
      {
        description: 'An example monorepo.',
        directory: 'packages/example',
        isolatedDeclarations: true,
        kind: 'library',
        name: 'example',
      },
      {
        description: 'Shared build configs for Example',
        directory: 'packages/build',
        kind: 'build',
        name: '@example/build',
      },
    ]);
  });

  it('adds a scoped new package under its unscoped directory', () => {
    expect(
      normalizeOptions({ ...options, newPackage: '@example/second' }).packages?.find(
        (pkg) => pkg.name === '@example/second',
      ),
    ).toMatchObject({ directory: 'packages/second', kind: 'library' });
  });
});

describe(produceMonorepo, () => {
  const setup = produceMonorepo({ mode: 'setup', options });

  it('creates every file of a new repository', () => {
    expect(listFiles(setup.files ?? {}).sort()).toMatchSnapshot();
  });

  it('produces the same files when transitioning its own output', () => {
    const transition = produceMonorepo({
      files: toIntake(setup.files ?? {}),
      mode: 'transition',
      options,
    });

    // Repository-owned files, such as docs and starter sources, aren't written again
    const transitionFiles = listFiles(transition.files ?? {});
    expect(transitionFiles.length).toBeGreaterThan(30);
    for (const file of transitionFiles) {
      expect(readFile(transition.files, file)).toBe(readFile(setup.files, file));
    }
  });

  it('only sends requests for new repositories', () => {
    const transition = produceMonorepo({
      files: toIntake(setup.files ?? {}),
      mode: 'transition',
      options: { ...options, keywords: ['one'] },
    });

    expect(transition.requests ?? []).toEqual([]);
  });

  it('sets up the GitHub repository with the same description, topics, and CI jobs', () => {
    const creation = produceMonorepo({
      mode: 'setup',
      options: { ...options, keywords: ['Type Script', 'example'] },
    });
    const requests = (creation.requests ?? []).filter((request) => request.type === 'octokit');
    const find = (endpoint: string) =>
      requests.find((request) => request.endpoint === endpoint)?.parameters;

    expect(find('PATCH /repos/{owner}/{repo}')).toMatchObject({
      allow_merge_commit: false,
      description: 'An example monorepo.',
      owner: 'example-org',
      repo: 'example',
    });
    expect(find('PUT /repos/{owner}/{repo}/topics')).toMatchObject({
      names: ['type-script', 'example'],
    });
    expect(JSON.parse(readFile(creation.files, 'packages/example/package.json'))).toMatchObject({
      keywords: ['Type Script', 'example'],
    });
    expect(JSON.parse(readFile(creation.files, 'cspell.json'))).toMatchObject({
      words: expect.arrayContaining(['script', 'type']) as unknown,
    });

    const ruleset = find('POST /repos/{owner}/{repo}/rulesets') as {
      rules: { parameters?: { required_status_checks?: { context: string }[] } }[];
    };
    expect(
      ruleset.rules
        .flatMap((rule) => rule.parameters?.required_status_checks ?? [])
        .map((check) => check.context),
    ).toEqual([
      'Build',
      'Dedupe Check',
      'Format Check',
      'Knip',
      'Lint',
      'Lint Spelling',
      'Test (macos-latest)',
      'Test (ubuntu-latest)',
      'Test (windows-latest)',
      'Type Check',
    ]);
  });

  it('gives a new GitHub repository each label exactly once', () => {
    const labels = (setup.requests ?? []).flatMap((request) =>
      request.type === 'octokit' && request.endpoint.includes('/labels')
        ? [request as { endpoint: string; parameters: { name: string; new_name?: string } }]
        : [],
    );
    const names = labels.map(({ parameters }) => parameters.new_name ?? parameters.name);
    expect(new Set(names).size).toBe(names.length);

    // GitHub's default labels
    expect(
      labels
        .filter(({ endpoint }) => endpoint.startsWith('PATCH'))
        .map(({ parameters }) => parameters.name)
        .sort(),
    ).toEqual([
      'accessibility',
      'bug',
      'documentation',
      'duplicate',
      'enhancement',
      'good first issue',
      'help wanted',
      'invalid',
      'question',
      'wontfix',
    ]);

    const templates = listFiles(setup.files ?? {}).filter((file) =>
      file.startsWith('.github/ISSUE_TEMPLATE/'),
    );
    for (const file of templates) {
      const { labels: used } = parse(readFile(setup.files, file)) as { labels: string[] };
      expect(names).toEqual(expect.arrayContaining(used));
    }
  });

  it.each([
    ['💖', 'An example monorepo.'],
    ['🗝️', 'An example monorepo. 🗝️'],
    ['👩‍💻', 'An example monorepo! 👩‍💻 '],
    ['💖', 'An example monorepo 1'],
  ])('uses %s in docs when the description is %j', (emoji, description) => {
    const creation = produceMonorepo({ mode: 'setup', options: { ...options, description } });

    for (const file of ['.github/CONTRIBUTING.md', '.github/PULL_REQUEST_TEMPLATE.md']) {
      expect(readFile(creation.files, file)).toContain(`! ${emoji}\n`);
    }
  });

  it('queues releases and gives version PRs a conventional title', () => {
    const release = parse(readFile(setup.files, '.github/workflows/release.yaml')) as {
      concurrency: unknown;
      jobs: { version: { steps: { with?: object }[] } };
    };
    expect(release.concurrency).toMatchObject({ queue: 'max' });
    expect(release.jobs.version.steps.at(-1)?.with).toMatchObject({
      'commit-message': 'chore: version packages',
      'pr-title': 'chore: version packages',
    });
  });

  it.each(['release', 'transitions'])('skips the %s workflow without a GitHub App', (name) => {
    const creation = produceMonorepo({
      mode: 'setup',
      options: { ...options, releaseApp: 'MY_APP' },
    });

    const workflow = parse(readFile(creation.files, `.github/workflows/${name}.yaml`)) as {
      jobs: Record<string, { if?: string; needs?: string }>;
    };
    for (const job of Object.values(workflow.jobs)) {
      if (!job.needs) {
        expect(job.if).toBe("github.event.repository.fork != true && vars.MY_APP_CLIENT_ID != ''");
      }
    }
  });

  it('forwards package extensions to root blocks through carriers', () => {
    const creation = produceMonorepo({
      mode: 'setup',
      options: { ...options, catalogs: 'named', newPackage: 'second', packages: [] },
    });

    const tsconfig = JSON.parse(readFile(creation.files, 'tsconfig.json')) as {
      references: { path: string }[];
    };
    expect(tsconfig.references).toEqual([
      { path: './packages/build' },
      { path: './packages/second' },
    ]);

    // The package Blocks' catalog entry must reach the root
    expect(readFile(creation.files, 'pnpm-workspace.yaml')).toContain("'@types/node':");
    expect(readFile(creation.files, 'packages/second/package.json')).toContain(
      '"@types/node": "catalog:dev"',
    );
  });

  it('only writes dependency versions that come from the pins package', () => {
    const pins = new Set<string>(Object.values(pinsPackage.devDependencies));
    const manifests = listFiles(setup.files ?? {}).filter((file) => file.endsWith('package.json'));

    for (const manifest of manifests) {
      const contents = JSON.parse(readFile(setup.files, manifest)) as Record<string, unknown>;
      for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
        for (const specifier of Object.values(
          (contents[field] as Record<string, string> | undefined) ?? {},
        )) {
          if (!specifier.startsWith('workspace:')) {
            expect(pins.has(specifier.replace(/^\^/, ''))).toBe(true);
          }
        }
      }
    }
  });

  it('only sends extensions to blocks in the production', () => {
    const normalized = normalizeOptions(options);
    const rootBlocks = new Set<unknown>(rootPreset.blocks);
    const packageBlocks = new Set<unknown>(packagePreset.blocks);

    const root = producePreset(rootPreset, {
      mode: 'setup',
      options: { ...normalized, preset: 'root' } as RootOptions,
    });
    for (const extension of root.extensions) {
      expect(rootBlocks.has(extension.block)).toBe(true);
    }

    const pkg = producePreset(packagePreset, {
      mode: 'setup',
      options: {
        ...normalized,
        package: normalized.packages?.[0],
        preset: 'package',
      } as never,
    });
    for (const extension of pkg.extensions) {
      expect(rootBlocks.has(extension.block) || packageBlocks.has(extension.block)).toBe(true);
    }
  });

  it('writes per-package scripts and runner config with a task runner', () => {
    const creation = produceMonorepo({
      mode: 'setup',
      options: { ...options, taskRunner: 'turbo' },
    });

    expect(readFile(creation.files, 'turbo.json')).toContain('"^build"');
    expect(JSON.parse(readFile(creation.files, 'package.json'))).toMatchObject({
      scripts: { build: 'turbo run build', test: 'turbo run test', typecheck: 'tsc -b' },
    });
    expect(JSON.parse(readFile(creation.files, 'packages/example/package.json'))).toMatchObject({
      scripts: { build: 'tsdown' },
    });
  });
});
