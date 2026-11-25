# CLI

`create-typescript-monorepo-bingo` supports all the flags supported by [Bingo CLI](https://www.create.bingo/cli)s.
It also provides a collection of custom flags per [Bingo CLI > Template Flags](https://www.create.bingo/cli#template-flags).

```shell
npx create-typescript-monorepo-bingo
```

## Remote Repositories

By default, `npx create-typescript-monorepo-bingo` creates only a local Git repository.
A `--remote` CLI flag exists as a convenience to create a remote repository on GitHub:

```shell
npx create-typescript-monorepo-bingo --remote
```

See [Setup > Remote Repositories](./Setup.md#remote-repositories) for what it sets up.

## Required Flags

These options can only be inferred when running on an existing repository.
Each will be prompted for when creating a new repository if not explicitly provided:

| Flag            | Description                                    |
| --------------- | ---------------------------------------------- |
| `--description` | 'Sentence case.' description of the repository |
| `--directory`   | which directory and repository name to use     |
| `--owner`       | organization or user owning the repository     |
| `--title`       | 'Title Case' title for the repository          |

For example, pre-populating all required options:

```shell
npx create-typescript-monorepo-bingo --description "My monorepo! 💖" --directory my-repo --owner my-org --title "My Repo"
```

## Optional Flags

The following flags may be provided on the CLI to customize their values.
Most default to a value inferred from an existing repository if transitioning one.

| Flag                      | Type       | Description                                                                         | Default                                  |
| ------------------------- | ---------- | ----------------------------------------------------------------------------------- | ---------------------------------------- |
| `--author`                | `string`   | Author name for `package.json` files                                                | `owner`                                  |
| `--catalogExcluded`       | `string[]` | `<catalog>:<dependency>` pairs to keep out of catalogs                              | _(none)_                                 |
| `--catalogShared`         | `string[]` | Dependencies to put in the default catalog                                          | Dependencies shared by multiple packages |
| `--catalogs`              | `string`   | [pnpm catalogs](./Blocks.md#package-management) mode: `default`, `named`, or `none` | `"default"`                              |
| `--email`                 | `string`   | Author email for `package.json` files                                               | _(none)_                                 |
| `--formatter`             | `string`   | `biome` _(existing repositories only)_, `none`, `oxfmt`, or `prettier`              | `"oxfmt"`                                |
| `--keywords`              | `string[]` | Keywords for new packages and a new GitHub repository's topics                      | _(none)_                                 |
| `--linter`                | `string`   | `eslint` or `none`                                                                  | `"eslint"`                               |
| `--newPackage`            | `string`   | Name of a package to add under `packages/`                                          | The `repository`, if it's new            |
| `--newPackageDescription` | `string`   | 'Sentence case.' description of the `--newPackage`                                  | `"The <newPackage> package in <title>."` |
| `--node`                  | `string`   | Node.js version for `.nvmrc` and CI                                                 | `"26.13.1"`                              |
| `--nodeEngines`           | `string`   | Node.js range for `engines.node`                                                    | `"^22.22.2 \|\| ^24.15.0 \|\| >=26.0.0"` |
| `--pnpm`                  | `string`   | pnpm version for `package.json`'s `packageManager` field                            | `"12.21.0"`                              |
| `--releaseApp`            | `string`   | Prefix of the [GitHub App](./Setup.md#release-github-app)'s variable and secret     | `"RELEASEBOT_APP"`                       |
| `--repository`            | `string`   | 'kebab-case' name of the repository                                                 | The same as `--directory`                |
| `--scope`                 | `string`   | npm scope for the private build package                                             | `@` and the `repository`                 |
| `--taskRunner`            | `string`   | [Task runner](./Blocks.md#task-runners): `none`, `nx`, `pnpm`, or `turbo`           | `"none"`                                 |
| `--testRunner`            | `string`   | `vitest`, or `other` to leave existing tests alone                                  | `"vitest"`                               |
| `--typescript7Alias`      | `string`   | Dependency name that aliases TypeScript 7                                           | `"typescript7"`                          |
| `--workflowExtension`     | `string`   | GitHub Actions file extension: `yaml` or `yml`                                      | `"yaml"`                                 |

For example, creating a repository with Prettier and Turborepo:

```shell
npx create-typescript-monorepo-bingo --formatter prettier --taskRunner turbo
```

`--formatter`, `--linter`, and `--testRunner` values that can't be inferred by later transitions are stored in the root `package.json`.

Array flags can be specified multiple times.
For example, sharing two dependencies in the default catalog:

```shell
npx create-typescript-monorepo-bingo --catalogShared react --catalogShared react-dom
```
