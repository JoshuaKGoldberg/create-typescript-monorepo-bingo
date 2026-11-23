import { z } from 'zod';

import { rootBase } from '../../bases/rootBase.ts';
import { defaults } from '../../options.ts';
import { action } from '../../utils/actions.ts';
import { readText } from '../../utils/files.ts';
import { getWorkflowPath } from '../../utils/options.ts';
import { formatYamlFile } from '../../utils/yaml.ts';

/**
 * Owns the weekly transitions workflow: it runs create-typescript-monorepo-bingo in
 * transition mode and opens a PR with any changes, using the release GitHub App's token.
 * The transition itself runs offline with no token, so it can't change live GitHub state.
 */
export const blockTransitions = rootBase.createBlock({
  about: {
    name: 'Transitions',
  },
  intake({ files, options }) {
    const existing = readText(
      files,
      `.github/workflows/${getWorkflowPath(options, 'transitions')}`,
    );
    return existing === undefined ? undefined : { existing };
  },
  props: {
    existing: z.string().optional(),
  },
  produce({ options, props }) {
    const app = options.releaseApp ?? defaults.releaseApp;

    // The template's own repository transitions itself with its own source.
    const self = options.packages?.find((pkg) => pkg.name === 'create-typescript-monorepo-bingo');
    const command = self
      ? `node ${self.directory}/src/bin/index.ts`
      : 'npx --yes create-typescript-monorepo-bingo@latest';

    const workflow = {
      name: 'Transitions',
      on: {
        schedule: [{ cron: '0 6 * * 1' }],
        workflow_dispatch: null,
      },
      permissions: {},
      jobs: {
        transition: {
          name: 'Transition',
          if: 'github.event.repository.fork != true',
          'runs-on': 'ubuntu-latest',
          permissions: { contents: 'read' },
          steps: [
            { uses: '$/.github/actions/setup' },
            {
              name: 'Transition',
              run: `${command} --mode transition --offline --skip-requests`,
            },
            {
              // CI installs with a frozen lockfile, so the transition's own install can't
              // update it; this does.
              name: 'Update Lockfile',
              run: 'pnpm install --no-frozen-lockfile',
            },
            {
              name: 'Create Token',
              id: 'create_token',
              uses: action('actions/create-github-app-token'),
              with: {
                'client-id': `\${{ vars.${app}_CLIENT_ID }}`,
                'permission-contents': 'write',
                'permission-pull-requests': 'write',
                // Transitions can change files in .github/workflows.
                'permission-workflows': 'write',
                'private-key': `\${{ secrets.${app}_PRIVATE_KEY }}`,
              },
            },
            {
              name: 'Create Pull Request',
              uses: action('peter-evans/create-pull-request'),
              with: {
                branch: 'create-typescript-monorepo-bingo/transition',
                'commit-message': 'chore: transition with create-typescript-monorepo-bingo',
                body: 'This PR was created by the weekly transition with [create-typescript-monorepo-bingo](https://github.com/JoshuaKGoldberg/create-typescript-monorepo-bingo).',
                'delete-branch': true,
                title: 'chore: transition with create-typescript-monorepo-bingo',
                token: '${{ steps.create_token.outputs.token }}',
              },
            },
          ],
        },
      },
    };

    return {
      // Without an inferred App, the defaults need setting up before releases and
      // transitions can run.
      suggestions:
        options.releaseApp === undefined && props.existing === undefined
          ? [
              `The transitions workflow, and CTM's release workflow where it adds one, use a GitHub App: set the ${app}_CLIENT_ID Actions variable and the ${app}_PRIVATE_KEY secret, or re-run with --releaseApp to use another prefix.`,
            ]
          : [],
      files: {
        '.github': {
          workflows: {
            [getWorkflowPath(options, 'transitions')]: formatYamlFile(workflow, props.existing, {
              name: `.github/workflows/transitions.${options.workflowExtension ?? 'yaml'}`,
              workflow: true,
            }).replace('workflow_dispatch: null', 'workflow_dispatch: ~'),
          },
        },
      },
    };
  },
});
