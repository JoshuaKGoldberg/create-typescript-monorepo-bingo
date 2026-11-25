import { z } from 'zod';

import { rootBase } from '../../bases/rootBase.ts';
import { defaults } from '../../options.ts';
import { action, createSetupSteps } from '../../utils/actions.ts';
import { readText } from '../../utils/files.ts';
import { getReleaseAppCondition, getWorkflowPath } from '../../utils/options.ts';
import { formatYamlFile } from '../../utils/yaml.ts';

/**
 * The transition itself runs offline, so that it can't change live GitHub state.
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

    // CTM's own repository transitions itself with its own source
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
          if: getReleaseAppCondition(options),
          'runs-on': 'ubuntu-latest',
          permissions: { contents: 'read' },
          steps: [
            ...createSetupSteps(options),
            {
              name: 'Transition',
              run: `${command} --mode transition --offline --skip-requests`,
            },
            {
              // CI's frozen lockfile would prevent the transition from updating it
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
                body: 'This PR was created by [`create-typescript-monorepo-bingo`](https://github.com/JoshuaKGoldberg/create-typescript-monorepo-bingo).',
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
      suggestions:
        options.releaseApp === undefined && props.existing === undefined
          ? [
              `GitHub Actions workflows need a GitHub App with a ${app}_CLIENT_ID variable and ${app}_PRIVATE_KEY secret. See https://github.com/JoshuaKGoldberg/create-typescript-monorepo-bingo/blob/main/docs/Setup.md#release-github-app.`,
            ]
          : [],
      files: {
        '.github': {
          workflows: {
            [getWorkflowPath(options, 'transitions')]: formatYamlFile(workflow, props.existing, {
              name: `.github/workflows/transitions.${options.workflowExtension ?? 'yaml'}`,
              sorted: options.workflowKeysSorted,
              workflow: true,
            }).replace('workflow_dispatch: null', 'workflow_dispatch: ~'),
          },
        },
      },
    };
  },
});
