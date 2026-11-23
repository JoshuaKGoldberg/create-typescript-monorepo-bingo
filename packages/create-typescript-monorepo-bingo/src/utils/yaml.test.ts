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

  it('keeps existing values, comments and order in place', () => {
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
      - uses: codecov/codecov-action@v7.1.0 # v7
        if: success()
`);
  });

  it('adds jobs an existing workflow is missing, changing nothing else', () => {
    const existing = `jobs:
  a:
    name: A

  c:
    name: Custom C # ours
`;

    expect(
      formatYamlFile({ jobs: { b: { name: 'B' }, c: { name: 'C' } } }, existing, {
        workflow: true,
      }),
    ).toBe(`jobs:
  a:
    name: A

  c:
    name: Custom C # ours

  b:
    name: B
`);
  });

  it('keeps the Node.js versions matrix of jobs it finds in line with engines', () => {
    const existing = `jobs:
  test_node:
    runs-on: [self-hosted]
    strategy:
      matrix:
        node-version:
          - 20
          - 22
        os: [ubuntu-latest]
`;

    expect(
      formatYamlFile(
        {
          jobs: {
            'test-node': {
              strategy: { matrix: { 'node-version': [22, 24], os: ['macos-latest'] } },
            },
          },
        },
        existing,
        { nodeEngines: '>=22', workflow: true },
      ),
    ).toBe(`jobs:
  test_node:
    runs-on: [self-hosted]
    strategy:
      matrix:
        node-version:
          - 22
          - 24
        os: [ubuntu-latest]
`);
  });

  it('keeps other existing YAML files as they are', () => {
    const existing = 'name: Setup # ours\nruns:\n  using: composite\n';
    expect(formatYamlFile({ name: 'Setup', inputs: {} }, existing)).toBe(existing);
  });

  it('names the file it cannot parse', () => {
    expect(() => formatYamlFile({}, 'a: [', { name: 'ci.yaml', workflow: true })).toThrow(
      /Could not parse ci\.yaml/,
    );
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
});
