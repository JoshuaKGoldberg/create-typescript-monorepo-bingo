# Transition Mode

If you have an existing monorepo that you'd like to migrate to the tooling from this template, you can run `npx create-typescript-monorepo-bingo` in it:

```shell
npx create-typescript-monorepo-bingo
```

The transition script will:

- Add any missing configuration files, dependencies, scripts, and CI jobs
- Update files [managed by the template](#managed-files)
- Format files it changed

It will also print suggestions for anything that needs manual changes.
You'll then need to do some [manual setup](./Setup.md#manual-setup) for GitHub apps and npm publishing.

Your repository must use pnpm 12 or newer, and its root `package.json` must not be a published package.

> [!WARNING]
> You'll want to review each of the changes.
> Adding ESLint and TypeScript 7 in particular can cause new complaints in existing code.

## Existing Tooling

Transitions generally keep what a repository already has:

- Existing values, comments, key order, and formatting in configuration files
- Existing docs, starter files, and package source files
- Existing formatters, Git hooks, release tools, and test runners, such as Prettier instead of Oxfmt or release-it instead of Changesets
- Packages that aren't built with tsdown

The exceptions are:

- `typescript` is switched to a [TypeScript 6 alias](./FAQs.md#why-are-there-two-versions-of-typescript), if it's already version 6 and packages are built with tsdown
- VS Code's TypeScript SDK path is updated for that alias, if it's the default
- Root scripts' bare `tsc` commands become `tsc -b`, if project references are added
- Prettier scripts become Oxfmt scripts, if `--formatter oxfmt` is used
- `node-version` matrices in CI jobs are kept in line with `engines.node`

### Managed Files

These files are replaced on every transition if they start with a _"Managed by create-typescript-monorepo-bingo"_ comment:

- `eslint.config.ts`, except for any config entries, imports, and statements you've added
- `packages/build/src/tsdown/base.ts`
- `vitest.config.ts`

## Adding Packages

Use `--newPackage` to add a package to an existing monorepo:

```shell
npx create-typescript-monorepo-bingo --newPackage my-lib --newPackageDescription "My library."
```

## Staying Up-to-Date

The _Transitions_ workflow re-runs the transition script weekly and sends a PR if there are any changes.

## CLI Options

You can customize the options tooling pieces are created with.
See [CLI.md](./CLI.md).

For example, skipping ESLint:

```shell
npx create-typescript-monorepo-bingo --linter none
```
