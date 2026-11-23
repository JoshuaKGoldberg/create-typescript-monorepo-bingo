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
      // The words CTM's workflow uses, when CTM writes it.
      extensions:
        props.existing === undefined
          ? [blockCSpell({ words: ['autorelease', 'octoguide', 'zizmor'] })]
          : [],
      files: {
        '.github': {
          workflows: {
            [getWorkflowPath(options, 'octoguide')]: (props.existing === undefined
              ? allowTrigger
              : (text: string) => text)(
              formatYamlFile(
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
            ),
          },
        },
      },
    };
  },
});

/**
 * OctoGuide only reads pull request metadata and never checks out its code, so
 * pull_request_target is safe here; this tells zizmor so.
 */
function allowTrigger(workflow: string) {
  return workflow.replace(
    /^(\s+)pull_request_target:$/m,
    '$1pull_request_target: # zizmor: ignore[dangerous-triggers] -- reads PR metadata only, no checkout',
  );
}
