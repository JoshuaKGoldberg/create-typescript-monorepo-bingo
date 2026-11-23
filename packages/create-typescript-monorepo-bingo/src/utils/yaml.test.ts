import { describe, expect, it } from 'vitest';

import { formatYamlFile } from './yaml.ts';

describe(formatYamlFile, () => {
  it('prints a new workflow with blank lines between sections and jobs', () => {
    expect(
      formatYamlFile(
        { name: 'CI', on: { push: null }, jobs: { a: { steps: [] }, b: { steps: [] } } },
        undefined,
        { workflow: true },
      ),
    ).toBe(`name: CI

on:
  push: null

jobs:
  a:
    steps: []

  b:
    steps: []
`);
  });

  it('updates an existing file in place, keeping comments and order', () => {
    const existing = `jobs:
  test:
    steps:
      - uses: codecov/codecov-action@v7.1.0 # v7
        if: success()
`;

    expect(
      formatYamlFile(
        { jobs: { test: { steps: [{ if: 'success()', uses: 'codecov/codecov-action@v7.1.1' }] } } },
        existing,
      ),
    ).toBe(`jobs:
  test:
    steps:
      - uses: codecov/codecov-action@v7.1.1 # v7
        if: success()
`);
  });

  it('keeps keys it does not produce and adds new ones in sorted position', () => {
    const existing = `jobs:
  a:
    name: A

  c:
    name: C
`;

    expect(formatYamlFile({ jobs: { b: { name: 'B' }, c: { name: 'C' } } }, existing)).toBe(`jobs:
  a:
    name: A

  b:
    name: B

  c:
    name: C
`);
  });

  it('keeps hand-written jobs in an existing workflow', () => {
    const existing = `jobs:
  custom:
    name: Custom

  lint:
    name: Lint
`;

    expect(formatYamlFile({ jobs: { lint: { name: 'Lint' } } }, existing, { workflow: true })).toBe(
      existing,
    );
  });

  it('keeps hand-added keys and steps in jobs it produces', () => {
    const existing = `concurrency: ci

jobs:
  build:
    timeout-minutes: 10
    steps:
      - uses: $/.github/actions/setup
      - run: echo custom
      - run: pnpm build
`;

    expect(
      formatYamlFile(
        {
          jobs: {
            build: { steps: [{ uses: '$/.github/actions/setup' }, { run: 'pnpm build' }] },
          },
        },
        existing,
        { workflow: true },
      ),
    ).toBe(existing);
  });

  it('unions scalar sequences', () => {
    expect(
      formatYamlFile({ branches: ['main', 'next'] }, 'branches:\n  - main\n  - release\n'),
    ).toBe('branches:\n  - main\n  - release\n  - next\n');
  });
});
