import { z } from 'zod';

import { rootBase } from '../../bases/rootBase.ts';
import { defaults } from '../../options.ts';
import { action } from '../../utils/actions.ts';
import { readText } from '../../utils/files.ts';
import { sortKeysDeep } from '../../utils/json.ts';
import { getWorkflowPath } from '../../utils/options.ts';
import { formatWorkflow } from '../../utils/yaml.ts';

export const blockGitHubActionsSetup = rootBase.createBlock({
  about: {
    name: 'GitHub Actions Setup',
  },
  intake({ files }) {
    const existingName = ['action.yaml', 'action.yml'].find(
      (name) => readText(files, `.github/actions/setup/${name}`) !== undefined,
    );
    return existingName
      ? { existing: readText(files, `.github/actions/setup/${existingName}`), existingName }
      : undefined;
  },
  props: {
    existing: z.string().optional(),
    existingName: z.string().optional(),
  },
  produce({ options, props }) {
    if (props.existing !== undefined && props.existingName) {
      const updated = withNodeVersion(props.existing, options.node);
      return updated === props.existing
        ? {}
        : { files: { '.github': { actions: { setup: { [props.existingName]: updated } } } } };
    }

    return {
      files: {
        '.github': {
          actions: {
            setup: {
              [getWorkflowPath(options, 'action')]: formatWorkflow(
                (options.workflowKeysSorted ? sortKeysDeep : (value: unknown) => value)({
                  name: 'Setup',
                  description: 'Sets up the repo for a typical CI job',
                  inputs: {
                    cache: {
                      description: 'Cache the pnpm store',
                      default: true,
                      required: false,
                    },
                    'install-flags': {
                      description: 'Flags to pass to `pnpm install`',
                      required: false,
                    },
                    'node-version': {
                      description: 'Node.js version to use',
                      default: options.node ?? defaults.node,
                      required: false,
                    },
                    'skip-checkout': {
                      description: 'Skip the checkout step if the repo is already checked out',
                      default: false,
                      required: false,
                    },
                  },
                  runs: {
                    steps: [
                      {
                        uses: action('actions/checkout'),
                        if: "${{ inputs.skip-checkout == 'false' }}",
                        with: { 'persist-credentials': false },
                      },
                      {
                        uses: action('pnpm/setup'),
                        with: {
                          cache: '${{ inputs.cache }}',
                          install: "${{ inputs.install-flags == '' }}",
                          runtime: 'node@${{ inputs.node-version }}',
                        },
                      },
                      {
                        // Avoids zizmor's template-injection rule
                        env: { INSTALL_FLAGS: '${{ inputs.install-flags }}' },
                        run: 'pnpm install $INSTALL_FLAGS',
                        if: "${{ inputs.install-flags != '' }}",
                        shell: 'bash',
                      },
                    ],
                    using: 'composite',
                  },
                }),
              ),
            },
          },
        },
      },
    };
  },
});

/**
 * Updates the default version in CTM's own action, rather than in a repository's own.
 */
function withNodeVersion(existing: string, node: string | undefined) {
  return node && existing.includes('runtime: node@${{ inputs.node-version }}')
    ? existing.replace(
        /^(\s+node-version:\n(?:\s+(?:description|required): .*\n)*\s+default: )\d+(?:\.\d+){2}$/m,
        (_, prefix: string) => `${prefix}${node}`,
      )
    : existing;
}
