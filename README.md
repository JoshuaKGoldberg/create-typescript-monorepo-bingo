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
| `--formatter`             | `oxfmt`, `prettier`, `biome` (only where already used) or `none`                   | inferred, else `oxfmt`                 |
| `--newPackage`            | Name of a package to add under `packages/`                                         |                                        |
| `--newPackageDescription` | Description of the `--newPackage`                                                  |                                        |
| `--node`                  | Node.js version for `.nvmrc` and CI                                                | `26.13.1`                              |
| `--nodeEngines`           | `engines.node` range                                                               | `^22.22.2 \|\| ^24.15.0 \|\| >=26.0.0` |
| `--pnpm`                  | pnpm version for `packageManager`                                                  | `12.21.0`                              |
| `--releaseApp`            | Prefix of the release GitHub App's `_CLIENT_ID` variable and `_PRIVATE_KEY` secret | `RELEASEBOT_APP`                       |
| `--scope`                 | npm scope of the private build package                                             | `@<repository>`                        |
| `--taskRunner`            | `none`, `pnpm`, `turbo` or `nx`                                                    | `none`                                 |
| `--testRunner`            | `vitest`, or `other` to leave a repository's own test setup alone                  | inferred, else `vitest`                |
| `--typescript7Alias`      | Dependency name aliasing TypeScript 7                                              | `typescript7`                          |
| `--workflowExtension`     | `yaml` or `yml`, for GitHub Actions files                                          | `yaml`                                 |

## How It Works

CTM is a Bingo template built on [Stratum](https://create.bingo/engines/stratum/about) Blocks, with two Bases:

- **Root Blocks** own repository-level files, such as CI workflows, the root `package.json` and `pnpm-workspace.yaml`
- **Package Blocks** own each package's `package.json`, `tsconfig.json` and `tsdown.config.ts`

Each library package is produced separately, then nested under its directory.
Whatever a package contributes to root files, such as its tsconfig reference or catalog entries, is forwarded into one final root production.

### What Transitions Keep

A transition adds what a repository is missing and leaves what it has:

- **Values already there win.** Scripts, dependency versions, workflow jobs and settings, VS Code settings and config keys a repository has are kept, along with comments (including in JSONC files), key order and formatting; a file whose content doesn't change is written back byte for byte.
  Upgrades are Renovate's job, and CTM never downgrades or narrows a version.
- **The exceptions,** which follow from CTM's TypeScript and CI setup:
  - `typescript` switches to the TypeScript 6 alias, from a 6.x version or range of one;
  - VS Code's `js/ts.tsdk.path` moves from the stock `node_modules/typescript/lib`, which the alias leaves without a `tsserver.js`, to TypeScript 6's;
  - the `node-version` matrices of CI jobs CTM also produces follow `engines.node`.
- **Missing pieces are added:** config keys, dependencies, scripts, docs, workflows, and CI jobs, unless an existing job already does the same thing (the same commands, scripts or action).
- **Owned files** are replaced on every transition, which is how shared config stays in sync: `eslint.config.ts`, `vitest.config.ts` and `packages/build/src/tsdown/base.ts`.
  CTM only replaces one it created, marked by its first line; an existing file without the marker is left alone, with a suggestion.
  `eslint.config.ts` keeps any config entries, imports and statements you add to it.
- **Tools a repository already uses are kept:** Prettier instead of Oxfmt, husky, lefthook or nano-staged instead of simple-git-hooks, and release-it, semantic-release, nx release or its own release workflow instead of CTM's Changesets workflow.
  An existing `nx.json`, `turbo.json`, `tsdown.config.ts` or setup action is the repository's, and so are config files with other names, such as `eslint.config.mjs` or `.github/renovate.json5`, along with that tool's dependencies, scripts and CI jobs.
- **Repositories without tsdown-built packages** don't get the build package or tsdown tooling.
- **Only the files CTM changes are formatted,** with the repository's formatter.
- **Repository-owned files,** such as docs (in any letter case, at the root, in `docs/` or in `.github/`), issue templates, README files, starter sources, a docs site package, and anything CTM doesn't know about, are created when missing and never touched again.

### Limitations

- Workspace globs must be single-level (`packages/*`) or exact directories.
- Packages that aren't built with tsdown are detected as repository-owned and left alone.
- In named catalog mode, dependencies with different versions across packages stay out of catalogs, with a suggestion printed; stray default-catalog entries are kept as they are.
- The root `package.json` must be private: repositories whose root is itself a published package are refused.
- Jobs CTM finds in an existing workflow are the repository's: CTM doesn't add steps to them or change their settings, apart from `node-version` matrices.
- A `.gitignore` entry that would hide existing directories, like `lib/` in a repository with `src/lib` folders, isn't added; a suggestion says so.
- Switching task runners on an existing repository doesn't replace its existing `build` and `test` scripts.
- A repository testing with something other than Vitest gets no Vitest config, CI test jobs, lint rules or starter tests. Once CTM manages a repository with no Vitest anywhere, later transitions keep it that way.
- A repository's own root Vitest config is kept, and its packages' test scripts are left to it.
- An existing `tsdown` older than the one CTM pins is kept, with a suggestion to update it, since new packages' configs spread a base written for CTM's version.
- If tsdown's workspace mode would skip a package config without its own `entry`, packages build with their own `tsdown` scripts instead of one root `tsdown`.
- A solution-style root `tsconfig.json`, with `"files": []`, is left as it is, so new packages' `tsdown.config.ts` files aren't in any tsconfig: add them to one for typed linting.
- New packages get `build` and `test` scripts; other per-package scripts a task runner runs, like `lint`, are left to add, since sibling packages' commands may not apply to a new one.
- The weekly transitions workflow doesn't regenerate an `actions.lock` file; re-run `gh actions-lock` when a transition PR changes workflow pins.
- `cspell.json` gets words for the owner, author, repository, scope, title and new package names CTM writes, but not for descriptions, which are your own prose: add any uncommon words in them.
- In Biome repositories, CTM formats the files it writes with `biome check --write` and adds no formatter of its own; its ESLint config leaves import and export sorting to Biome.
- A root TypeScript older than 6 is kept, without the TypeScript 7 alias, whose `tsc` would replace it; a suggestion says to update. Updating TypeScript 6 can step back a patch version, to the newest `@typescript/typescript6`.
- With ESLint older than 9, CTM doesn't set up its ESLint config; a suggestion says to update.
- A root `tsconfig.json` that packages extend is left as it is, without a `tsc -b` typecheck, since packages would inherit what CTM adds to it.
- Oxfmt can't load `oxfmt.config.ts` in a root with `"type": "commonjs"`; a suggestion says so.
- Package tsconfigs that don't extend the build package's base are the repository's own: CTM leaves them alone, and existing packages without one don't get one.
- In a repository without a formatter CTM knows (Oxfmt, Prettier or Biome), CTM adds none, so styling from dprint or ESLint isn't overwritten. Opt in with `--formatter oxfmt`, then run `pnpm format` once.
- A repository without ESLint gets CTM's strict, type-aware rules, which existing code may not meet yet: a suggestion explains running `pnpm lint --fix` and recording the rest with `eslint --suppress-all`. CTM's lint job doesn't build first, so packages that export build output lint without each other's types until they're built.
- Existing tests without a root Vitest config are left alone, whatever runs them, as with `--testRunner other`. Opt in to CTM's Vitest setup with `--testRunner vitest`.
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
