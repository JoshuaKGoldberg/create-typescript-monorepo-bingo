import { createTemplate } from 'bingo';

import { rootOptionsShape } from './options.ts';
import { prepareRoot } from './prepare/prepareRoot.ts';
import { produceMonorepo } from './production/produceMonorepo.ts';

export const template = createTemplate({
  about: {
    name: 'create-typescript-monorepo-bingo',
  },
  options: rootOptionsShape,
  prepare: prepareRoot,
  produce: (context) => produceMonorepo(context as Parameters<typeof produceMonorepo>[0]),
});

/**
 * Creates a config file that overrides inferred options, such as a package's `kind`.
 */
export const createConfig: typeof template.createConfig = template.createConfig;
