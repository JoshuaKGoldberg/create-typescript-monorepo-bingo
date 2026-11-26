import type { RootOptions } from '../options.ts';

/**
 * Renovate keeps these up-to-date with a custom manager in `.github/renovate.json`.
 */
const actionVersions: Partial<Record<string, readonly [version: string, digest: string]>> = {
  'actions/checkout': ['v7.0.1', '3d3c42e5aac5ba805825da76410c181273ba90b1'], // renovate: datasource=github-tags depName=actions/checkout
  'actions/create-github-app-token': ['v3.4.0', 'f418cff399f7aef4c2f0ad47e25ca7a6abbdd6fc'], // renovate: datasource=github-tags depName=actions/create-github-app-token
  'changesets/action': ['v2.1.2', 'ae32849d5ba541f9ae29e40e22a623bc13562f51'], // renovate: datasource=github-tags depName=changesets/action
  'codecov/codecov-action': ['v7.1.1', '303a32d7a59b442fa8d48b6a1cc6825c09c847a5'], // renovate: datasource=github-tags depName=codecov/codecov-action
  'JoshuaKGoldberg/all-contributors-auto-action': [
    'v0.7.0',
    'c578423db9b2c14d3cee9c72f6c2aed31c128030',
  ], // renovate: datasource=github-tags depName=JoshuaKGoldberg/all-contributors-auto-action
  'marcalexiei/changesets-release-commenter': [
    'v0.3.1',
    '97096fbe9cde74fcae784df963274998e0090a7c',
  ], // renovate: datasource=github-tags depName=marcalexiei/changesets-release-commenter
  'octoguide/bot': ['0.33.1', '8d29abce6793b35c6bfab51d4db6bfa62634b871'], // renovate: datasource=github-tags depName=octoguide/bot
  'peter-evans/create-pull-request': ['v8.1.3', '3ffccacd46053766916f087ce41d627c0b8cf2d1'], // renovate: datasource=github-tags depName=peter-evans/create-pull-request
  'pnpm/setup': ['v3.2.0', '731dfb6463bbd11c11fd0ee11fe00ed0e36d48a1'], // renovate: datasource=github-tags depName=pnpm/setup
};

/**
 * Version comments are added by {@link annotateActionVersions}.
 */
export function action(name: string, subpath = ''): string {
  const pinned = actionVersions[name];
  if (pinned === undefined) {
    throw new Error(`No pinned version for the '${name}' action.`);
  }

  return `${name}${subpath}@${pinned[1]}`;
}

/**
 * A repository's own setup action won't have the inputs of CTM's.
 */
export function createSetupSteps(
  options: RootOptions,
  inputs?: Record<string, unknown>,
): { uses: string; with?: Record<string, unknown> }[] {
  if (options.setupAction && (!inputs || options.setupAction === 'setup')) {
    return [
      { uses: action('actions/checkout'), with: { 'persist-credentials': false } },
      { uses: `./.github/actions/${options.setupAction}`, ...(inputs && { with: inputs }) },
    ];
  }

  return [{ uses: '$/.github/actions/setup', ...(inputs && { with: inputs }) }];
}

export function annotateActionVersions(yaml: string): string {
  return yaml.replaceAll(
    /^([ \t-]*uses: )([\w.-]+\/[\w.-]+)((?:\/[\w.-]+)*)@([0-9a-f]{40})$/gm,
    (line: string, prefix: string, name: string, subpath: string, digest: string) => {
      const pinned = actionVersions[name];
      return pinned?.[1] === digest ? `${prefix}${name}${subpath}@${digest} # ${pinned[0]}` : line;
    },
  );
}
