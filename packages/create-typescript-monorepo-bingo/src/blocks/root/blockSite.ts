import { z } from 'zod';

import { rootBase } from '../../bases/rootBase.ts';
import { parseJsonText, readText } from '../../utils/files.ts';
import { blockESLint } from './blockESLint.ts';
import { blockGitHubActionsCI } from './blockGitHubActionsCI.ts';
import { blockVitest } from './blockVitest.ts';

export const blockSite = rootBase.createBlock({
  about: {
    name: 'Site',
  },
  intake({ files }) {
    const existing = readText(files, 'package.json');
    return existing === undefined ? undefined : { rootPackageJson: existing };
  },
  props: {
    rootPackageJson: z.string().optional(),
  },
  produce({ options, props }) {
    const sites = (options.packages ?? []).filter((pkg) => pkg.kind === 'site');
    if (!sites.length) {
      return {};
    }

    const rootScripts = Object.entries(
      (parseJsonText(props.rootPackageJson).scripts as Record<string, string> | undefined) ?? {},
    );

    const findRootScript = (command: string) =>
      rootScripts.find(([, value]) => value === command)?.[0];

    return {
      extensions: [
        blockESLint({
          lintPrebuildSteps: sites
            .filter((site) => site.scripts?.includes('prebuild'))
            .map((site) => `pnpm --filter=${site.name} prebuild`),
        }),
        blockGitHubActionsCI({
          jobs: sites
            .filter((site) => site.scripts?.includes('build'))
            .map((site, index) => {
              // The ... filter builds workspace packages the site may import
              const command = `pnpm --filter=${site.name}... build`;
              const rootScript = findRootScript(command);
              return {
                id: index === 0 ? 'build_site' : `build_site_${site.name.replace(/\W/g, '_')}`,
                name: sites.length === 1 ? 'Build Site' : `Build Site (${site.name})`,
                steps: [{ run: rootScript ? `pnpm ${rootScript}` : command }],
              };
            }),
        }),
        blockVitest({ coverageExclude: ['**/*.astro'] }),
      ],
    };
  },
});
