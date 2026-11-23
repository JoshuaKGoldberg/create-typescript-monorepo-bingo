import { z } from 'zod';

import { rootBase } from '../../bases/rootBase.ts';
import { defaults } from '../../options.ts';
import { action } from '../../utils/actions.ts';
import { readText } from '../../utils/files.ts';
import { getWorkflowPath } from '../../utils/options.ts';
import { formatYamlFile } from '../../utils/yaml.ts';

/**
 * Owns the composite `.github/actions/setup` action that CI jobs start with:
 * checkout, pnpm and Node.js through `pnpm/setup`, and dependency installation.
 */
export const blockGitHubActionsSetup = rootBase.createBlock({
  about: {
    name: 'GitHub Actions Setup',
  },
  intake({ files, options }) {
    const existing = readText(files, `.github/actions/setup/${getWorkflowPath(options, 'action')}`);
    return existing === undefined ? undefined : { existing };
  },
  props: {
    existing: z.string().optional(),
  },
  produce({ options, props }) {
    return {
      files: {
        '.github': {
          actions: {
            setup: {
              [getWorkflowPath(options, 'action')]: formatYamlFile(
                {
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
                      type: 'string',
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
                        run: 'pnpm install ${{ inputs.install-flags }}',
                        if: "${{ inputs.install-flags != '' }}",
                        shell: 'bash',
                      },
                    ],
                    using: 'composite',
                  },
                },
                props.existing,
                { workflow: true },
              ),
            },
          },
        },
      },
    };
  },
});
