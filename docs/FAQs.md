# FAQs

## Can I use _(insert tool here)_ with this template?

Yes!
After you set up a repository, you can substitute in any tools you'd like.
Transitions keep many existing tools, per [Transition > Existing Tooling](./Transition.md#existing-tooling), but add back other tooling that's been removed.

## How can I add a config entry to `eslint.config.ts`?

Add it alongside the existing entries.
Transitions keep entries you've added, but replace changes inside the template's own entries.

## How can I stop a managed file from being replaced?

Remove the _"Managed by create-typescript-monorepo-bingo"_ comment from any of the [managed files](./Transition.md#managed-files).

## How can I suppress existing ESLint complaints?

If your repository is adopting ESLint, you can use [ESLint bulk suppressions](https://eslint.org/docs/latest/use/suppressions) to record any complaints that can't be auto-fixed:

```shell
pnpm lint --fix
pnpm exec eslint --suppress-all
```

Or, undo the changes and use `--linter none` to not set up ESLint.

## Why are there two versions of TypeScript?

TypeScript 7.0 doesn't include the JavaScript API used by tools such as typescript-eslint and tsdown.
The `typescript` dependency is aliased to [`@typescript/typescript6`](https://www.npmjs.com/package/@typescript/typescript6) for those tools, and a `typescript7` alias provides the `tsc` binary.

## Why wasn't my package changed?

Only packages that are built with tsdown are managed.
They must be matched by single-level workspace globs, such as `packages/*`, or exact directories.

A package's `tsconfig.json` is only managed if it extends the build package's base.

## Why wasn't my repository's formatter, linter, or test runner changed?

- Formatters other than Biome, Oxfmt, and Prettier aren't recognized.
  Use `--formatter oxfmt` to switch to Oxfmt, then run `pnpm format` once.
- ESLint versions older than 9 aren't supported.
- Existing tests without a root Vitest config are left alone.
  Use `--testRunner vitest` to set up Vitest.

## Why wasn't my repository's TypeScript changed?

TypeScript is kept if no packages are built with tsdown, if it's older than version 6, or if a `tsconfig.json` uses `ignoreDeprecations`.
Update to TypeScript 6 and remove options that TypeScript 7 doesn't support, then transition again.
