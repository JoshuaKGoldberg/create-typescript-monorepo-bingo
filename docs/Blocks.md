# Blocks

`create-typescript-monorepo-bingo` provides over two dozen pieces of tooling as [Stratum](https://create.bingo/engines/stratum/about) Blocks, ranging from code building and formatting to various forms of GitHub repository management.

- [Building](#building)
- [Formatting](#formatting)
- [Linting](#linting)
- [Package Management](#package-management)
- [Releases](#releases)
- [Repository Management](#repository-management)
- [Task Runners](#task-runners)
- [Testing](#testing)
- [Type Checking](#type-checking)

## Building

[**tsdown**](https://tsdown.dev): Builds each package's output definitions and JavaScript files into `dist/`.
[publint](https://publint.dev) and [Are The Types Wrong](https://arethetypeswrong.github.io) check built packages in CI.

Packages share a private `@<scope>/build` package containing a `tsconfig.base.json` and base tsdown config.
Their `exports` point to source files in development and to `dist/` when published.

## Formatting

[**Oxfmt**](https://oxc.rs/docs/guide/usage/formatter): Formats code.

[**lint-staged**](https://github.com/lint-staged/lint-staged) and [**simple-git-hooks**](https://github.com/toplenboren/simple-git-hooks): Format staged files on commit.

## Linting

[**CSpell**](https://cspell.org): Spell checks across all source files.

[**ESLint**](https://eslint.org): Lints source files with [typescript-eslint](https://typescript-eslint.io) and plugins for ESLint comments, JSDoc, JSON, Markdown, `package.json` files, regular expressions, sorting, Vitest, and YAML.

[**Knip**](https://knip.dev): Detects unused files, dependencies, and code exports.

## Package Management

[**pnpm**](https://pnpm.io): Manages packages in a workspace, with `pnpm dedupe --check` in CI.

The `--catalogs` flag sets how [pnpm catalogs](https://pnpm.io/catalogs) are used:

- `default`: dependencies declared by multiple packages with the same version are in the default catalog
- `named`: external dependencies are in `dev`, `peer`, and `prod` catalogs
- `none`: no catalogs are used

## Releases

[**Changesets**](https://github.com/changesets/changesets): Releases packages with independent versions and [npm trusted publishing](https://docs.npmjs.com/trusted-publishers).

## Repository Management

[**All Contributors**](https://allcontributors.org): Tracks contributors in the README.md.

[**GitHub Actions**](https://github.com/features/actions): Runs each tool in CI, and [transitions](./Transition.md) the repository weekly.

[**OctoGuide**](https://octo.guide): Checks that PR titles are in conventional commits format.

[**Renovate**](https://docs.renovatebot.com): Keeps dependencies up-to-date.

**VS Code**: Extensions, settings, and debugging tasks.

Contributing docs, issue and PR templates, a code of conduct, a license, and a security policy are also created.

## Task Runners

tsdown, Vitest, and `tsc -b` each run once across the workspace, so no task runner is used by default.
The `--taskRunner` flag adds per-package `build` and `test` scripts with one of:

- `nx`: [Nx](https://nx.dev)
- `pnpm`: [pnpm](https://pnpm.io)
- `turbo`: [Turborepo](https://turborepo.com)

Existing `build` and `test` scripts are kept when switching task runners.

## Testing

[**Vitest**](https://vitest.dev): Runs tests with one project per package, with coverage uploaded to [Codecov](https://codecov.io) in CI.

## Type Checking

[**TypeScript**](https://typescriptlang.org): Type checks across all packages' project references with `tsc -b`.
See [FAQs > Why are there two versions of TypeScript?](./FAQs.md#why-are-there-two-versions-of-typescript).
