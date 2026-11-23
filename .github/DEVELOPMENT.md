# Development

After [forking the repo from GitHub](https://help.github.com/articles/fork-a-repo) and [installing pnpm](https://pnpm.io/installation):

```shell
git clone https://github.com/<your-name-here>/create-typescript-monorepo-bingo
cd create-typescript-monorepo-bingo
pnpm install
```

This repository is a pnpm workspace monorepo.
Each package lives under `packages/`, and shared build configuration lives in `packages/build`.

## Building

Run [tsdown](https://tsdown.dev) in workspace mode to build every package's `src/` into `dist/`:

```shell
pnpm build
```

## Formatting

[Oxfmt](https://oxc.rs/docs/guide/usage/formatter) is used to format code.
It should be applied automatically when you save files in VS Code or make a Git commit.

To manually reformat all files, you can run:

```shell
pnpm format --write
```

## Linting

[ESLint](https://eslint.org) is used with [typescript-eslint](https://typescript-eslint.io) to lint JavaScript, TypeScript, JSON, YAML and Markdown files:

```shell
pnpm lint
```

Other linters include [cspell](https://cspell.org) for spelling and [Knip](https://knip.dev) for unused files, dependencies and exports:

```shell
pnpm lint:spelling
pnpm knip
```

## Testing

[Vitest](https://vitest.dev) is used for tests, with one project per package:

```shell
pnpm test
```

Add the `--coverage` flag to compute test coverage and place reports in the `coverage/` directory.

## Type Checking

TypeScript 7 runs type checking across every package's project references:

```shell
pnpm typecheck
```

The `typescript` dependency is aliased to TypeScript 6 for tools that use TypeScript's JavaScript API, such as typescript-eslint and tsdown's declaration generator.

## Releasing

Releases are managed with [Changesets](https://github.com/changesets/changesets).
Add a changeset describing your change with:

```shell
pnpm changeset
```
