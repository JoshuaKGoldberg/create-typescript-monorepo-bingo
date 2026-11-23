import { z } from 'zod';

import { rootBase } from '../../bases/rootBase.ts';
import { action } from '../../utils/actions.ts';
import { readText } from '../../utils/files.ts';
import { getWorkflowPath } from '../../utils/options.ts';
import { formatYamlFile } from '../../utils/yaml.ts';
import { blockCSpell } from './blockCSpell.ts';

/**
 * Owns the OctoGuide workflow, which checks PR titles against Conventional Commits.
 */
export const blockOctoGuide = rootBase.createBlock({
  about: {
    name: 'OctoGuide',
  },
  intake({ files, options }) {
    const existing = readText(files, `.github/workflows/${getWorkflowPath(options, 'octoguide')}`);
    return existing === undefined ? undefined : { existing };
  },
  props: {
    existing: z.string().optional(),
  },
  produce({ options, props }) {
    return {
      extensions: [blockCSpell({ words: ['autorelease', 'octoguide'] })],
      files: {
        '.github': {
          workflows: {
            [getWorkflowPath(options, 'octoguide')]: formatYamlFile(
              {
                name: 'OctoGuide',
                on: { pull_request_target: { types: ['edited', 'opened'] } },
                jobs: {
                  octoguide: {
                    if: "${{ !endsWith(github.actor, '[bot]') && !contains(github.event.pull_request.labels.*.name, 'autorelease') }}",
                    'runs-on': 'ubuntu-latest',
                    permissions: { 'pull-requests': 'write' },
                    steps: [
                      {
                        uses: action('octoguide/bot'),
                        with: {
                          'github-token': '${{ secrets.GITHUB_TOKEN }}',
                          rules: JSON.stringify({ 'pr-title-conventional': true }, null, 2),
                        },
                      },
                    ],
                  },
                },
              },
              props.existing,
              {
                name: `.github/workflows/octoguide.${options.workflowExtension ?? 'yaml'}`,
                workflow: true,
              },
            ),
          },
        },
      },
    };
  },
});
