import type { IntakeDirectory } from 'bingo-fs';
import { z } from 'zod';

import { rootBase } from '../../bases/rootBase.ts';
import { defaults, type RootOptions } from '../../options.ts';
import { getDirectory } from '../../utils/files.ts';
import { getRepositoryUrl, usesTaskRunner } from '../../utils/options.ts';
import { formatYaml } from '../../utils/yaml.ts';

const docPaths = [
  '.github/CODE_OF_CONDUCT.md',
  '.github/CONTRIBUTING.md',
  '.github/DEVELOPMENT.md',
  '.github/ISSUE_TEMPLATE/01-bug.{yaml}',
  '.github/ISSUE_TEMPLATE/02-documentation.{yaml}',
  '.github/ISSUE_TEMPLATE/03-feature.{yaml}',
  '.github/ISSUE_TEMPLATE/04-tooling.{yaml}',
  '.github/PULL_REQUEST_TEMPLATE.md',
  '.github/SECURITY.md',
  'LICENSE.md',
  'README.md',
];

export const blockDocs = rootBase.createBlock({
  about: {
    name: 'Docs',
  },
  intake({ files, options }) {
    return {
      existing: docPaths
        .map((docPath) => resolveDocPath(options, docPath))
        .filter((docPath) => hasEquivalentDoc(files, docPath)),
    };
  },
  props: {
    existing: z.array(z.string()).optional(),
  },
  produce({ options, props }) {
    const existing = new Set(props.existing);
    const docs = createDocs(options);
    const files: Record<string, unknown> = {};

    for (const [templatePath, contents] of Object.entries(docs)) {
      const docPath = resolveDocPath(options, templatePath);
      if (existing.has(docPath)) {
        continue;
      }

      const segments = docPath.split('/');
      const fileName = segments.at(-1) ?? docPath;
      segments.pop();
      let directory = files;
      for (const segment of segments) {
        directory = (directory[segment] ??= {}) as Record<string, unknown>;
      }
      directory[fileName] = contents;
    }

    return { files: files as Record<string, string> };
  },
});

/**
 * Uses the emoji at the end of the description, if there is one.
 */
function getEmoji({ description }: RootOptions): string {
  const last = Array.from(
    new Intl.Segmenter().segment(description.trim()),
    ({ segment }) => segment,
  ).at(-1);
  return last && /\p{Extended_Pictographic}/u.test(last) ? last : '💖';
}

/**
 * Whether a doc exists, in any letter case and any directory GitHub looks in.
 */
function hasEquivalentDoc(files: IntakeDirectory | undefined, docPath: string) {
  const segments = docPath.split('/');
  const fileName = (segments.at(-1) ?? docPath).toLowerCase();
  const directory = segments.slice(0, -1).join('/');

  if (directory === '.github/ISSUE_TEMPLATE') {
    const templates = Object.keys(getDirectory(files, directory) ?? {});
    return templates.some((name) => /\.ya?ml$|\.md$/i.test(name) && name !== 'config.yml');
  }

  const stem = fileName.replace(/\.md$/, '');
  return ['', 'docs', '.github'].some((place) =>
    Object.keys((place ? getDirectory(files, place) : files) ?? {}).some((name) => {
      const lower = name.toLowerCase();
      return lower === fileName || (stem === 'license' && lower.startsWith('license'));
    }),
  );
}

function resolveDocPath(options: RootOptions, docPath: string) {
  return docPath.replace('{yaml}', options.workflowExtension ?? defaults.workflowExtension);
}

function createIssueTemplate(name: string, description: string, title: string, label: string) {
  return formatYaml({
    body: [
      {
        attributes: {
          label: 'Overview',
          description: 'What would you like to report?',
        },
        type: 'textarea',
        validations: { required: true },
      },
      {
        attributes: {
          label: 'Additional Info',
          description: "Any additional info you'd like to provide.",
        },
        type: 'textarea',
      },
    ],
    description,
    labels: [label],
    name,
    title,
  });
}

function createDocs(options: RootOptions): Record<(typeof docPaths)[number], string> {
  const url = getRepositoryUrl(options);
  const packages = (options.packages ?? []).filter((pkg) => pkg.kind === 'library');

  return {
    '.github/CODE_OF_CONDUCT.md': `# Contributor Covenant Code of Conduct

This project follows the [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct), version 2.1.

Please report unacceptable behavior to the project maintainers${options.email ? ` at ${options.email}` : ''}.
`,
    '.github/CONTRIBUTING.md': `# Contributing

Thanks for your interest in contributing to \`${options.repository}\`! ${getEmoji(options)}

## Code of Conduct

This project contains a [Contributor Covenant code of conduct](./CODE_OF_CONDUCT.md) all contributors are expected to follow.

## Reporting Issues

Please do [report an issue on the issue tracker](${url}/issues/new/choose) if there's any bugfix, documentation improvement, or general enhancement you'd like to see in the repository!
Please fully fill out all required fields in the most appropriate issue form.

## Sending Contributions

Sending your own changes as contribution is always appreciated!
There are two steps involved:

1. [Finding an Issue](#finding-an-issue)
2. [Sending a Pull Request](#sending-a-pull-request)

### Finding an Issue

With the exception of very small typos, all changes to this repository generally need to correspond to an [unassigned open issue marked as \`status: accepting prs\` on the issue tracker](${url}/issues?q=is:issue+is:open+label:%22status:+accepting+prs%22+no:assignee+).
If this is your first time contributing, consider searching for [unassigned issues that also have the \`good first issue\` label](${url}/issues?q=is:issue+is:open+label:%22good+first+issue%22+label:%22status:+accepting+prs%22+no:assignee+).

### Sending a Pull Request

Once you've identified an open issue accepting PRs that doesn't yet have a PR sent, you're free to send a pull request.
Be sure to fill out the pull request template's requested information -- otherwise your PR will likely be closed.

PRs are also expected to have a title that adheres to [conventional commits](https://www.conventionalcommits.org/en/v1.0.0).
Only PR titles need to be in that format, not individual commits.

See [DEVELOPMENT.md](./DEVELOPMENT.md) for how to set up the repository locally.
`,
    '.github/DEVELOPMENT.md': `# Development

After [forking the repo from GitHub](https://help.github.com/articles/fork-a-repo) and [installing pnpm](https://pnpm.io/installation):

\`\`\`shell
git clone https://github.com/(your-name-here)/${options.repository}
cd ${options.repository}
pnpm install
\`\`\`

Each package is under \`packages/\`${options.buildPackageSkipped ? '' : ', with shared build configuration in `packages/build`'}.

${
  options.buildPackageSkipped
    ? ''
    : `## Building

${
  usesTaskRunner(options)
    ? `Run [**tsdown**](https://tsdown.dev) through ${options.taskRunner === 'turbo' ? 'Turborepo' : options.taskRunner === 'nx' ? 'Nx' : 'pnpm'} to build each package's \`src/\` into \`dist/\`:`
    : "Run [**tsdown**](https://tsdown.dev) to build each package's `src/` into `dist/`:"
}

\`\`\`shell
pnpm build
\`\`\`

`
}${
      options.formatter === 'none'
        ? ''
        : `## Formatting

${
  options.formatter === 'prettier'
    ? '[Prettier](https://prettier.io)'
    : options.formatter === 'biome'
      ? '[Biome](https://biomejs.dev)'
      : '[Oxfmt](https://oxc.rs/docs/guide/usage/formatter)'
} is used to format code.
It should be applied automatically when you save files in VS Code or make a Git commit.

To manually reformat all files, you can run:

\`\`\`shell
${options.formatter === 'biome' ? 'pnpm exec biome check --write .' : 'pnpm format --write'}
\`\`\`

`
    }## Linting

${
  options.linter === 'none'
    ? 'Linters include'
    : `[ESLint](https://eslint.org) is used with [typescript-eslint](https://typescript-eslint.io) to lint source files:

\`\`\`shell
pnpm lint
\`\`\`

Other linters include`
} [CSpell](https://cspell.org) for spelling and [Knip](https://knip.dev) for unused files, dependencies, and code exports:

\`\`\`shell
pnpm lint:spelling
pnpm knip
\`\`\`

## Testing

${
  options.testRunner === 'other'
    ? `Run tests with:

\`\`\`shell
pnpm test
\`\`\`
`
    : `[Vitest](https://vitest.dev) is used for tests:

\`\`\`shell
pnpm test
\`\`\`

${
  usesTaskRunner(options)
    ? 'Run `pnpm test:coverage` to compute test coverage across all packages'
    : 'Add the `--coverage` flag to compute test coverage'
} and place reports in the \`coverage/\` directory.
`
}
${
  options.rootTSConfigExtended || options.typescriptKept
    ? ''
    : `## Type Checking

Run the [TypeScript](https://typescriptlang.org) command-line to type check all packages:

\`\`\`shell
pnpm typecheck
\`\`\`

The \`typescript\` dependency is aliased to TypeScript 6 for tools that use its JavaScript API.

`
}## Releasing

Releases are managed with [Changesets](https://github.com/changesets/changesets).
Add a changeset describing your change with:

\`\`\`shell
pnpm changeset
\`\`\`

The release workflow will send a _\`chore: version packages\`_ PR, then publish once it's merged.
`,
    '.github/ISSUE_TEMPLATE/01-bug.{yaml}': createIssueTemplate(
      '🐛 Bug',
      'Report a bug trying to run the code',
      '🐛 Bug: <short description of the bug>',
      'type: bug',
    ),
    '.github/ISSUE_TEMPLATE/02-documentation.{yaml}': createIssueTemplate(
      '📝 Documentation',
      'Report a typo or missing area of documentation',
      '📝 Documentation: <short description of the request>',
      'area: documentation',
    ),
    '.github/ISSUE_TEMPLATE/03-feature.{yaml}': createIssueTemplate(
      '🚀 Feature',
      'Request that a new feature be added or an existing feature improved',
      '🚀 Feature: <short description of the feature>',
      'type: feature',
    ),
    '.github/ISSUE_TEMPLATE/04-tooling.{yaml}': createIssueTemplate(
      '🛠 Tooling',
      'Report a bug or request an enhancement in repository tooling',
      '🛠 Tooling: <short description of the change>',
      'area: tooling',
    ),
    '.github/PULL_REQUEST_TEMPLATE.md': `<!-- 👋 Hi, thanks for sending a PR to ${options.repository}! ${getEmoji(options)}
Please fill out all fields below and make sure each item is true and [x] checked.
Otherwise we may not be able to review your PR. -->

## PR Checklist

- [ ] Addresses an existing open issue: fixes #000
- [ ] That issue was marked as [\`status: accepting prs\`](${url}/issues?q=is:open+is:issue+label:%22status:+accepting+prs%22)
- [ ] Steps in [CONTRIBUTING.md](${url}/blob/main/.github/CONTRIBUTING.md) were taken

## Overview

<!-- Description of what is changed and how the code change does that. -->
`,
    '.github/SECURITY.md': `# Security Policy

We take all security vulnerabilities seriously.
If you have a vulnerability or other security issues to disclose:

- Thank you very much, please do!
- Please send them to us by [reporting a vulnerability on GitHub](${url}/security/advisories/new)

We appreciate your efforts and responsible disclosure and will make every effort to acknowledge your contributions.
`,
    'LICENSE.md': `# MIT License

Copyright (c) ${options.author ?? options.owner}

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
`,
    'README.md': `<h1 align="center">${options.title}</h1>

<p align="center">${options.description}</p>

<p align="center">
	<!-- prettier-ignore-start -->
	<!-- ALL-CONTRIBUTORS-BADGE:START - Do not remove or modify this section -->
	<!-- ALL-CONTRIBUTORS-BADGE:END -->
	<!-- prettier-ignore-end -->
	<a href="${url}/blob/main/LICENSE.md" target="_blank"><img alt="📝 License: MIT" src="https://img.shields.io/badge/%F0%9F%93%9D_license-MIT-21bb42.svg" /></a>
</p>

${
  packages.length
    ? `## Packages

| Package | Description |
| ------- | ----------- |
${packages.map((pkg) => `| [\`${pkg.name}\`](./${pkg.directory}) | ${pkg.description ?? ''} |`).join('\n')}

`
    : ''
}## Contributors

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->

<!-- ALL-CONTRIBUTORS-LIST:END -->

> 💝 This monorepo was templated with [\`create-typescript-monorepo-bingo\`](https://github.com/JoshuaKGoldberg/create-typescript-monorepo-bingo) using the [Bingo framework](https://create.bingo).
`,
  };
}
