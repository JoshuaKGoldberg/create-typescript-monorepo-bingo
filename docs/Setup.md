# Setup Mode

You can run `npx create-typescript-monorepo-bingo` in your terminal to interactively create a new repository:

```shell
npx create-typescript-monorepo-bingo
```

The setup script will by default:

1. Prompt you for a directory and some starting information
2. Initialize the new directory as a local Git repository
3. Create the template's files in that directory

You'll then need to do some [manual setup](#manual-setup) for GitHub apps and npm publishing.
Your new repository will then be ready for development!
Hooray! 🥳

## Remote Repositories

With `--remote`, the script will also create a public repository on GitHub with:

- The description, and `--keywords` as topics
- Labels used by issue templates and Renovate
- Only squash merging allowed, with auto-merge and automatic branch deletion
- A ruleset that requires PRs and CI checks on `main`, which admins can bypass
- Secret scanning and push protection

It'll be shown on GitHub as _generated from_ this template.
GitHub only sets that when a repository is created, so it can't be added to existing repositories.

> Prefer `--remote` over GitHub's _Use this template_ button.
> The button copies this repository's own code instead of running the template.

## Manual Setup

Some tooling needs settings that `create-typescript-monorepo-bingo` can't set up for you.

### Release GitHub App

The _Release_ and _Transitions_ workflows use a [GitHub App](https://docs.github.com/en/apps/creating-github-apps).
They're skipped until it's set up.

1. Create a GitHub App with **Contents**, **Pull requests**, and **Workflows** write permissions
2. Install it on the repository
3. Add its client ID as a `RELEASEBOT_APP_CLIENT_ID` Actions variable
4. Add a private key as a `RELEASEBOT_APP_PRIVATE_KEY` Actions secret

Use [`--releaseApp`](./CLI.md) to change the `RELEASEBOT_APP` prefix.

### GitHub Apps

Install these apps on the repository:

- [All Contributors](https://github.com/apps/allcontributors): sends PRs to add contributors when the _Contributors_ workflow asks
- [Codecov](https://github.com/apps/codecov): reports test coverage
- [Renovate](https://github.com/apps/renovate): sends PRs to update dependencies

### npm

The _Release_ workflow publishes to npm with [trusted publishing](https://docs.npmjs.com/trusted-publishers).
npm only lets existing packages add trusted publishers.
If a package isn't on npm yet, run `pnpm build`, then run `pnpm publish --access public` in the package's directory to publish its first version by hand.
Then, on each package's npm settings page, add a GitHub Actions trusted publisher for your repository with the `release.yaml` (or `.yml`) workflow, and allow it to `npm publish`.

## Options

You can customize the options tooling pieces are created with.
See [CLI.md](./CLI.md).
