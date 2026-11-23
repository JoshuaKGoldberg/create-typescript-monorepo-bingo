/**
 * Versions of the GitHub Actions that CTM writes into workflows.
 * CTM's own `.github/renovate.json` has a custom regex manager for this file,
 * so Renovate keeps these current the same way it does for workflow files.
 */
const actionVersions: Record<string, string> = {
  'actions/checkout': 'v7.0.1', // renovate: datasource=github-tags depName=actions/checkout
  'actions/create-github-app-token': 'v3.3.0', // renovate: datasource=github-tags depName=actions/create-github-app-token
  'changesets/action': 'v2.1.2', // renovate: datasource=github-tags depName=changesets/action
  'codecov/codecov-action': 'v7.1.1', // renovate: datasource=github-tags depName=codecov/codecov-action
  'JoshuaKGoldberg/all-contributors-auto-action': 'v0.7.0', // renovate: datasource=github-tags depName=JoshuaKGoldberg/all-contributors-auto-action
  'marcalexiei/changesets-release-commenter': 'v0.3.1', // renovate: datasource=github-tags depName=marcalexiei/changesets-release-commenter
  'octoguide/bot': '0.33.1', // renovate: datasource=github-tags depName=octoguide/bot
  'pnpm/setup': 'v3.2.0', // renovate: datasource=github-tags depName=pnpm/setup
};

/**
 * Gets a `uses:` reference for a GitHub Action, at CTM's pinned version.
 */
export function action(name: string, subpath = ''): string {
  const version = actionVersions[name];
  if (version === undefined) {
    throw new Error(`No pinned version for the '${name}' action.`);
  }

  return `${name}${subpath}@${version}`;
}
