<h1 align="center">Create TypeScript Monorepo (Bingo)</h1>

<p align="center">Quickstart-friendly TypeScript monorepo template with comprehensive, configurable, opinionated tooling. 🗃️</p>

<p align="center">
	<!-- prettier-ignore-start -->
	<!-- ALL-CONTRIBUTORS-BADGE:START - Do not remove or modify this section -->
	<!-- ALL-CONTRIBUTORS-BADGE:END -->
	<!-- prettier-ignore-end -->
	<a href="https://github.com/JoshuaKGoldberg/create-typescript-monorepo-bingo/blob/main/LICENSE.md" target="_blank"><img alt="📝 License: MIT" src="https://img.shields.io/badge/%F0%9F%93%9D_license-MIT-21bb42.svg" /></a>
</p>

A [Bingo](https://create.bingo) template for pnpm workspace monorepos of TypeScript packages.
It creates new monorepos, and keeps existing ones in sync with its tooling, one package or one whole repository at a time.

> Looking for a single-package repository?
> See [create-typescript-app](https://github.com/JoshuaKGoldberg/create-typescript-app).

## Usage

Create a new monorepo:

```shell
npx create-typescript-monorepo-bingo
```

Bring an existing monorepo's tooling in line with the template, or update it to the template's latest:

```shell
npx create-typescript-monorepo-bingo --mode transition
```

Add a package to an existing monorepo, with zero hand edits to the root tsconfig, catalogs or other configs:

```shell
npx create-typescript-monorepo-bingo --mode transition --newPackage my-lib --newPackageDescription "My library."
```

Transitions are designed to be re-run weekly, and a generated `.github/workflows/transitions.yaml` does that, opening a PR with any changes.
After the first transition, a repository that hasn't drifted gets no changes.

## What You Get

- **pnpm 12 workspaces** with `packages/*`, [catalogs](#catalogs), and dependency build permissions
- **A private `@<scope>/build` package** that shares one `tsconfig.base.json` and one [tsdown](https://tsdown.dev) base config with every package
- **tsdown** in workspace mode: bundled ESM, declarations, and [publint](https://publint.dev) + [attw](https://arethetypeswrong.github.io) checks in CI
- **Source `exports`** in development, with `publishConfig.exports` pointing at `dist/`
- **TypeScript 7 for `tsc -b`** over generated project references, with `typescript` aliased to TypeScript 6 for tools that need its JavaScript API
- **ESLint** with [typescript-eslint](https://typescript-eslint.io), plus plugins for JSDoc, regular expressions, sorting, ESLint comments, JSON, YAML, Markdown, `package.json` files and Vitest
- **[Vitest](https://vitest.dev)** with one project per package, coverage, and Codecov uploads through OIDC
- **[Oxfmt](https://oxc.rs/docs/guide/usage/formatter)** formatting, run on staged files by [simple-git-hooks](https://github.com/toplenboren/simple-git-hooks) and [lint-staged](https://github.com/lint-staged/lint-staged)
- **[Knip](https://knip.dev)**, **[CSpell](https://cspell.org)** and `pnpm dedupe --check`
- **GitHub Actions CI**: Node.js version and OS matrices, plus a job for each check
- **[Changesets](https://github.com/changesets/changesets) releases** with independent versions, a GitHub App token, and npm trusted publishing
- **Renovate**, **OctoGuide**, **All Contributors**, VS Code settings (with TypeScript 6's language service), and contributor docs

### Task Runners

No task runner is needed by default: tsdown, Vitest and `tsc -b` each run once across the workspace.
Opt into one with `--taskRunner pnpm`, `--taskRunner turbo` or `--taskRunner nx` to orchestrate per-package `build` and `test` scripts.

### Catalogs

`--catalogs` chooses how [pnpm catalogs](https://pnpm.io/catalogs) are used:

- `default` (for new repositories): dependencies that two or more packages declare with the same version share the default catalog
- `named`: every external dependency goes in a catalog by its field, `dev`, `prod` or `peer`, with a Renovate range strategy per catalog
- `none`: no catalogs

Existing repositories keep the mode they have.
CTM writes catalog entries itself, so `catalogMode` stays `manual`.

### TypeScript 6 and 7

typescript-eslint, tsdown's declaration generator and `astro check` still need TypeScript's JavaScript API, which TypeScript 7.0 doesn't have.
So `typescript` is aliased to [`@typescript/typescript6`](https://www.npmjs.com/package/@typescript/typescript6), which only ships a `tsc6` binary, and a `typescript7` alias provides `tsc`.
Set `--typescript7Alias` to use a different name; an existing alias, such as flint's `@typescript/native`, is kept.

## Options

Options are inferred from an existing repository's files, and prompted for in new ones.

| Option                    | Description                                                                        | Default                                |
| ------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------- |
| `--owner`                 | GitHub organization or user the repository is under                                | (prompted)                             |
| `--repository`            | Kebab-case name of the repository                                                  | (prompted)                             |
| `--title`                 | Title Case title for the repository                                                | (prompted)                             |
| `--description`           | Sentence-case description of the repository                                        | (prompted)                             |
| `--author`, `--email`     | Author for `package.json` files                                                    | from the root manifest                 |
| `--catalogExcluded`       | `<catalog>:<dependency>` pairs to keep out of catalogs                             | inferred                               |
| `--catalogShared`         | Dependencies to put in the default catalog                                         | inferred                               |
| `--catalogs`              | `none`, `default` or `named`                                                       | `default` for new repos                |
| `--newPackage`            | Name of a package to add under `packages/`                                         |                                        |
| `--newPackageDescription` | Description of the `--newPackage`                                                  |                                        |
| `--node`                  | Node.js version for `.nvmrc` and CI                                                | `26.13.1`                              |
| `--nodeEngines`           | `engines.node` range                                                               | `^22.22.2 \|\| ^24.15.0 \|\| >=26.0.0` |
| `--pnpm`                  | pnpm version for `packageManager`                                                  | `12.21.0`                              |
| `--releaseApp`            | Prefix of the release GitHub App's `_CLIENT_ID` variable and `_PRIVATE_KEY` secret | `RELEASEBOT_APP`                       |
| `--scope`                 | npm scope of the private build package                                             | `@<repository>`                        |
| `--taskRunner`            | `none`, `pnpm`, `turbo` or `nx`                                                    | `none`                                 |
| `--typescript7Alias`      | Dependency name aliasing TypeScript 7                                              | `typescript7`                          |
| `--workflowExtension`     | `yaml` or `yml`, for GitHub Actions files                                          | `yaml`                                 |

## How It Works

CTM is a Bingo template built on [Stratum](https://create.bingo/engines/stratum/about) Blocks, with two Bases:

- **Root Blocks** own repository-level files, such as CI workflows, the root `package.json` and `pnpm-workspace.yaml`
- **Package Blocks** own each package's `package.json`, `tsconfig.json` and `tsdown.config.ts`

Each library package is produced separately, then nested under its directory.
Whatever a package contributes to root files, such as its tsconfig reference or catalog entries, is forwarded into one final root production.

### What Transitions Keep

Versions are never downgraded below what a repository already has, and ranges that already allow CTM's version are left as they are.
Beyond that, each file is handled one of three ways:

- **Merged:** `package.json` files, tsconfigs, `pnpm-workspace.yaml`, workflows, VS Code settings, `cspell.json`, Renovate, Changesets and All Contributors configs.
  CTM updates the keys it manages and keeps everything else: unknown keys, scripts, dependencies, jobs and steps, comments (including in JSONC files), and formatting.
- **Generated, with additions kept:** `eslint.config.ts` is CTM's config plus any config entries and imports you add after it; edits inside CTM's own entries are replaced.
  `knip.config.ts` and `oxfmt.config.ts` are rewritten while they're plain static objects without comments, and left alone otherwise.
- **Owned:** the shared `packages/build` configs and `vitest.config.ts` are CTM's, and are how config stays in sync across repositories.
- **Repository-owned:** docs, README files, starter sources, a docs site package, and anything CTM doesn't know about are created when missing and never touched again.

To override inferred options, such as a package's `kind`, install the template as a devDependency (`pnpm add -D create-typescript-monorepo-bingo`) and add a `create-typescript-monorepo-bingo.config.ts`:

```ts
import { createConfig } from 'create-typescript-monorepo-bingo';

export default createConfig({
  options: {
    // ...
  },
});
```

### Limitations

- Workspace globs must be single-level (`packages/*`) or exact directories.
- Packages that aren't built with tsdown are detected as repository-owned and left alone.
- In named catalog mode, dependencies with different versions across packages stay out of catalogs, with a suggestion printed; stray default-catalog entries are kept as they are.
- CI matrices follow `engines.node` and are replaced on each transition, and a hand-edited `schedule` is kept.
  Other lists in merged YAML files, such as branches, are combined, so an entry CTM no longer produces stays until removed by hand.
- Steps in workflows are matched by their `id`, `name`, `uses` or `run`, so if CTM changes a step's command, the old step stays next to the new one until removed by hand.
- Config files with alternate names, such as `eslint.config.mjs` or `.github/renovate.json5`, are left alone, with a suggestion to move to CTM's file name.
- pnpm 12.0.0 or newer is needed.

## Development

See [`.github/CONTRIBUTING.md`](./.github/CONTRIBUTING.md), then [`.github/DEVELOPMENT.md`](./.github/DEVELOPMENT.md).
Run `pnpm e2e` to produce real repositories with the template and run every CI check in them.

## Contributors

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->

<!-- ALL-CONTRIBUTORS-LIST:END -->

> 💝 This monorepo is managed by itself: it's templated with [create-typescript-monorepo-bingo](https://github.com/JoshuaKGoldberg/create-typescript-monorepo-bingo).
