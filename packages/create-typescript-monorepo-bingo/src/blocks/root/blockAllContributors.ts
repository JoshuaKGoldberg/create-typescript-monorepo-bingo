import { z } from 'zod';

import { rootBase } from '../../bases/rootBase.ts';
import { action } from '../../utils/actions.ts';
import { parseJsonText, readText } from '../../utils/files.ts';
import { formatJson, withDefaults } from '../../utils/json.ts';
import { getWorkflowPath } from '../../utils/options.ts';
import { formatYamlFile } from '../../utils/yaml.ts';

/**
 * Owns `.all-contributorsrc` and the workflow that adds new contributors.
 * The README table is left to the All Contributors bot, so they never flip-flop.
 * Existing settings and contributors are kept.
 */
export const blockAllContributors = rootBase.createBlock({
  about: {
    name: 'All Contributors',
  },
  intake({ files, options }) {
    const existing = readText(files, '.all-contributorsrc');
    const existingWorkflow = readText(
      files,
      `.github/workflows/${getWorkflowPath(options, 'contributors')}`,
    );
    return {
      ...(existing && { existing }),
      ...(existingWorkflow && { existingWorkflow }),
    };
  },
  props: {
    existing: z.string().optional(),
    existingWorkflow: z.string().optional(),
  },
  produce({ options, props }) {
    return {
      files: {
        '.all-contributorsrc': formatJson(
          withDefaults(props.existing === undefined ? undefined : parseJsonText(props.existing), {
            badgeTemplate:
              '<img alt="👪 All Contributors: <%= contributors.length %>" src="https://img.shields.io/badge/%F0%9F%91%AA_all_contributors-<%= contributors.length %>-21bb42.svg" />',
            commit: false,
            commitConvention: 'angular',
            commitType: 'docs',
            contributors: [],
            contributorsPerLine: 7,
            files: ['README.md'],
            imageSize: 100,
            projectName: options.repository,
            projectOwner: options.owner,
            repoHost: 'https://github.com',
            repoType: 'github',
          }),
          props.existing,
        ),
        '.github': {
          workflows: {
            [getWorkflowPath(options, 'contributors')]: formatYamlFile(
              {
                name: 'Contributors',
                on: { push: { branches: ['main'] } },
                jobs: {
                  new_contributor_check: {
                    name: 'New Contributor Check',
                    if: 'github.event.repository.fork != true',
                    'runs-on': 'ubuntu-slim',
                    permissions: {
                      contents: 'read',
                      issues: 'write',
                      'pull-requests': 'write',
                    },
                    steps: [
                      { uses: action('actions/checkout'), with: { 'fetch-depth': 0 } },
                      { uses: '$/.github/actions/setup', with: { 'skip-checkout': true } },
                      {
                        uses: action('JoshuaKGoldberg/all-contributors-auto-action'),
                        env: { GITHUB_TOKEN: '${{ secrets.GITHUB_TOKEN }}' },
                      },
                    ],
                  },
                },
              },
              props.existingWorkflow,
              {
                name: `.github/workflows/contributors.${options.workflowExtension ?? 'yaml'}`,
                workflow: true,
              },
            ),
          },
        },
      },
    };
  },
});
