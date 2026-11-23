import { createTemplate } from 'bingo';

import { rootOptionsShape } from './options.ts';
import { prepareRoot } from './prepare/prepareRoot.ts';
import { produceMonorepo } from './production/produceMonorepo.ts';

/**
 * The create-typescript-monorepo-bingo Template: a pnpm workspace of tsdown-built
 * TypeScript packages, with shared config in a private build package.
 */
export const template = createTemplate({
  about: {
    name: 'create-typescript-monorepo-bingo',
  },
  options: rootOptionsShape,
  prepare: prepareRoot,
  produce: (context) => produceMonorepo(context as Parameters<typeof produceMonorepo>[0]),
});

/**
 * Creates a config file for the template, such as a \`create-typescript-monorepo-bingo.config.ts\`
 * whose \`options\` override what's inferred, for example a package's \`kind\`.
 */
export const createConfig: typeof template.createConfig = template.createConfig;
