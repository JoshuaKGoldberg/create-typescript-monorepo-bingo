// cspell:ignore widgetco zentrix zorbix

/**
 * End-to-end tests: produces real repositories with the template, installs them,
 * runs every CI check in them, and verifies a second transition changes nothing.
 *
 * Usage: `pnpm e2e [scenario names...]`, from the repository root.
 * Set CTM_E2E_BINGO to a bingo checkout to include the bingo scenarios,
 * and CTM_E2E_BINGO_REF to the git ref to test (by default, HEAD).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { prepareOptions, runTemplate } from 'bingo';
import { intakeDirectory } from 'bingo-fs';

import type { RootOptions } from '../options.ts';
import { template } from '../template.ts';

type Mode = 'setup' | 'transition';

type Step = { cli: string[] } | { mode: Mode; options?: Partial<RootOptions> };

interface Scenario {
  checks: string[];
  name: string;

  /**
   * Repository to copy (with git archive) as the starting point.
   */
  source?: { directory: string; ref: string };
  steps: Step[];
}

const newRepository = {
  author: 'Ex Ample',
  description: 'An example monorepo.',
  email: 'ex@example.com',
  // Not dictionary words, as spell checking must allow.
  owner: 'widgetco-labs',
  repository: 'example',
  title: 'Example',
} satisfies Partial<RootOptions>;

const declarationsCheck = 'declarations have no any';

const allChecks = [
  'pnpm build',
  declarationsCheck,
  'pnpm typecheck',
  'pnpm lint',
  'pnpm test run',
  'pnpm test run --coverage',
  'pnpm format --list-different',
  'pnpm knip',
  'pnpm lint:spelling',
  'pnpm dedupe --check',
];

const repositoryRoot = path.resolve(import.meta.dirname, '../../../..');
const bin = path.join(import.meta.dirname, '../bin/index.ts');
const bingoSource = process.env.CTM_E2E_BINGO && {
  directory: process.env.CTM_E2E_BINGO,
  ref: process.env.CTM_E2E_BINGO_REF ?? 'HEAD',
};

const scenarios: Scenario[] = [
  {
    checks: allChecks,
    name: 'setup',
    steps: [{ mode: 'setup', options: newRepository }],
  },
  {
    checks: allChecks,
    name: 'add-package',
    steps: [
      { mode: 'setup', options: newRepository },
      { mode: 'transition', options: { newPackage: 'second' } },
    ],
  },
  {
    checks: allChecks,
    name: 'named-catalogs',
    steps: [
      { mode: 'setup', options: { ...newRepository, catalogs: 'named' } },
      { mode: 'transition', options: { newPackage: '@example/zorbix' } },
    ],
  },
  {
    checks: allChecks,
    // Repeated folder names across parents, and a package in a top-level directory.
    name: 'multi-parent',
    steps: [
      {
        mode: 'setup',
        options: {
          ...newRepository,
          packages: [
            {
              description: 'An app.',
              directory: 'apps/example',
              kind: 'library',
              name: 'app-example',
            },
            {
              description: 'A package.',
              directory: 'packages/example',
              kind: 'library',
              name: 'example',
            },
            { description: 'Tools.', directory: 'tools', kind: 'library', name: 'tools' },
          ],
        },
      },
      { mode: 'transition', options: { newPackage: 'second' } },
    ],
  },
  {
    checks: [
      'pnpm build',
      'pnpm test',
      'pnpm test:coverage',
      'pnpm typecheck',
      'pnpm lint',
      'pnpm knip',
      'pnpm lint:spelling',
    ],
    // A new package whose folder name another parent already has renames both projects.
    name: 'multi-parent-turbo',
    steps: [
      {
        mode: 'setup',
        options: {
          ...newRepository,
          packages: [
            { description: 'A CLI.', directory: 'apps/cli', kind: 'library', name: 'app-cli' },
            { description: 'A core.', directory: 'packages/core', kind: 'library', name: 'core' },
          ],
          taskRunner: 'turbo',
        },
      },
      { mode: 'transition', options: { newPackage: 'cli' } },
    ],
  },
  ...(['pnpm', 'turbo', 'nx'] as const).map((taskRunner) => ({
    checks: [
      'pnpm build',
      'pnpm test',
      'pnpm test:coverage',
      'pnpm typecheck',
      'pnpm lint',
      'pnpm knip',
      'pnpm lint:spelling',
    ],
    name: `task-runner-${taskRunner}`,
    steps: [
      { mode: 'setup' as const, options: { ...newRepository, taskRunner } },
      { mode: 'transition' as const, options: { newPackage: 'second' } },
    ],
  })),
  {
    checks: allChecks.map((check) =>
      check === 'pnpm format --list-different' ? 'pnpm exec prettier --check .' : check,
    ),
    name: 'prettier-yml-scoped',
    steps: [
      {
        mode: 'setup',
        options: {
          ...newRepository,
          catalogs: 'none',
          formatter: 'prettier',
          workflowExtension: 'yml',
        },
      },
      { mode: 'transition', options: { newPackage: '@example/scoped' } },
    ],
  },
  {
    checks: [
      'pnpm build',
      'pnpm test',
      'pnpm test:coverage',
      'pnpm typecheck',
      'pnpm lint',
      'pnpm exec prettier --check .',
      'pnpm knip',
      'pnpm lint:spelling',
      'pnpm dedupe --check',
    ],
    name: 'pnpm-tasks-named-prettier',
    steps: [
      {
        mode: 'setup',
        options: { ...newRepository, catalogs: 'named', formatter: 'prettier', taskRunner: 'pnpm' },
      },
      { mode: 'transition', options: { newPackage: 'second' } },
    ],
  },
  {
    checks: allChecks,
    name: 'cli',
    steps: [
      {
        cli: [
          '--mode',
          'setup',
          '--owner',
          'zentrix',
          '--repository',
          'example',
          '--title',
          'Example',
          '--description',
          'An example monorepo.',
        ],
      },
      {
        cli: [
          '--mode',
          'transition',
          '--newPackage',
          'second',
          '--newPackageDescription',
          'A second package.',
        ],
      },
    ],
  },
  {
    checks: allChecks,
    name: 'self',
    source: { directory: repositoryRoot, ref: 'HEAD' },
    steps: [{ mode: 'transition' }],
  },
  ...(bingoSource
    ? [
        {
          checks: ['pnpm --filter=site prebuild', ...allChecks],
          name: 'bingo',
          source: bingoSource,
          steps: [{ mode: 'transition' as const }],
        },
        {
          checks: ['pnpm --filter=site prebuild', ...allChecks],
          name: 'bingo-named-catalogs',
          source: bingoSource,
          steps: [{ mode: 'transition' as const, options: { catalogs: 'named' as const } }],
        },
      ]
    : []),
];

const requested = process.argv.slice(2);
const selected = requested.length
  ? scenarios.filter((scenario) => requested.includes(scenario.name))
  : scenarios;

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'ctm-e2e-'));
const results: { failures: string[]; name: string }[] = [];

for (const scenario of selected) {
  console.log(`\n▶ ${scenario.name}`);
  try {
    results.push({ failures: await runScenario(scenario), name: scenario.name });
  } catch (error) {
    console.log(`  ✗ ${String(error)}`);
    results.push({ failures: [String(error)], name: scenario.name });
  }
}

console.log('\nResults:');
for (const { failures, name } of results) {
  console.log(`  ${failures.length ? '✗' : '✓'} ${name}`);
  for (const failure of failures) {
    console.log(`      ${failure}`);
  }
}

console.log(`\nRepositories are in ${workspace}`);

if (results.some(({ failures }) => failures.length)) {
  process.exitCode = 1;
}

async function runScenario(scenario: Scenario): Promise<string[]> {
  const directory = path.join(workspace, scenario.name);
  const failures: string[] = [];

  // The CLI's setup mode creates the directory itself, and refuses existing ones.
  const firstStep = scenario.steps.at(0);
  if (!firstStep || !('cli' in firstStep)) {
    await fs.mkdir(directory, { recursive: true });
  }

  if (scenario.source) {
    const { directory: sourceDirectory, ref } = scenario.source;
    const archive = execFileSync('git', ['-C', sourceDirectory, 'archive', ref], {
      maxBuffer: 1024 ** 3,
    });
    execFileSync('tar', ['-x', '-C', directory], { input: archive });
  }

  for (const step of scenario.steps) {
    await produce(directory, step);
  }

  git(directory, ['init', '--quiet']);
  git(directory, ['add', '--all']);
  git(directory, ['commit', '--allow-empty', '--quiet', '--no-verify', '--message', 'produced']);

  for (const check of scenario.checks) {
    if (check === declarationsCheck) {
      const leaks = await findAnyInDeclarations(directory);
      console.log(`  ${leaks.length ? '✗' : '✓'} ${check}`);
      if (leaks.length) {
        failures.push(`${check}:\n        ${leaks.join('\n        ')}`);
      }
      continue;
    }

    const [command = 'pnpm', ...args] = check.split(' ');
    const result = spawnSync(command, args, { cwd: directory, encoding: 'utf8' });
    const passed = result.status === 0;
    console.log(`  ${passed ? '✓' : '✗'} ${check}`);
    if (!passed) {
      failures.push(`${check}: ${lastLines(`${result.stdout}\n${result.stderr}`)}`);
    }
  }

  // Builds may write ignored outputs, but shouldn't change files the repository tracks,
  // as tsdown's devExports would if a package's exports didn't match what it generates.
  const changedByChecks = git(directory, ['status', '--porcelain']).trim();
  if (changedByChecks) {
    console.log('  ✗ checks leave tracked files unchanged');
    failures.push(`checks changed files:\n${changedByChecks}`);
    git(directory, ['stash', '--include-untracked', '--quiet']);
    git(directory, ['stash', 'drop', '--quiet']);
  }

  await produce(directory, { mode: 'transition' });

  const status = git(directory, ['status', '--porcelain']).trim();
  console.log(`  ${status ? '✗' : '✓'} second transition makes no changes`);
  if (status) {
    failures.push(
      `second transition changed files:\n${git(directory, ['diff', '--stat']).trim()}\n${status}`,
    );
  }

  return failures;
}

async function produce(directory: string, step: Step) {
  if ('cli' in step) {
    const result = spawnSync(
      'node',
      [bin, '--directory', directory, '--offline', '--skip-requests', ...step.cli],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    if (result.status !== 0) {
      throw new Error(`CLI failed: ${lastLines(`${result.stdout}\n${result.stderr}`)}`);
    }
    return;
  }

  const { mode, options = {} } = step;
  const files =
    mode === 'transition'
      ? await intakeDirectory(directory, { exclude: /node_modules|^\.git$/ })
      : undefined;

  const prepared = await prepareOptions(template, {
    directory,
    existing: options,
    ...(files && { files }),
    offline: true,
  });

  await runTemplate(template, {
    directory,
    ...(files && { files }),
    mode,
    offline: true,
    options: prepared as RootOptions,
    skips: { requests: true },
  });
}

/**
 * Finds built declaration files with more `any` types than their package's sources,
 * which tsdown can emit silently when a referenced package's types weren't built first.
 */
async function findAnyInDeclarations(directory: string) {
  const leaks: string[] = [];
  const countAny = (text: string) =>
    text
      .replaceAll(/\/\*[\s\S]*?\*\//g, '')
      .replaceAll(/\/\/.*$/gm, '')
      .replaceAll(/(['"`])(?:\\.|(?!\1)[^\\\n])*\1/g, '')
      .match(/\bany\b/g)?.length ?? 0;

  for await (const packageJson of fs.glob('*/*/package.json', { cwd: directory })) {
    const packageDirectory = path.join(directory, path.dirname(packageJson));
    let declarations = 0;
    let sources = 0;

    for await (const file of fs.glob('dist/**/*.d.mts', { cwd: packageDirectory })) {
      declarations += countAny(await fs.readFile(path.join(packageDirectory, file), 'utf8'));
    }

    for await (const file of fs.glob('src/**/*.ts', { cwd: packageDirectory })) {
      if (!file.endsWith('.test.ts')) {
        sources += countAny(await fs.readFile(path.join(packageDirectory, file), 'utf8'));
      }
    }

    if (declarations > sources) {
      leaks.push(
        `${path.dirname(packageJson)}: ${String(declarations)} in dist/*.d.mts vs ${String(sources)} in src/`,
      );
    }
  }

  return leaks;
}

function git(directory: string, args: string[]) {
  return execFileSync('git', args, {
    cwd: directory,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_EMAIL: 'e2e@example.com',
      GIT_AUTHOR_NAME: 'e2e',
      GIT_COMMITTER_EMAIL: 'e2e@example.com',
      GIT_COMMITTER_NAME: 'e2e',
    },
  });
}

function lastLines(text: string) {
  return text.trim().split('\n').slice(-15).join('\n        ');
}
