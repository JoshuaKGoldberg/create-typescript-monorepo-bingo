import { createBase } from 'bingo-stratum';

import { rootOptionsShape } from '../options.ts';

/**
 * The Base for repository-level Blocks, such as CI, linting and the workspace file.
 */
export const rootBase = createBase({
  options: rootOptionsShape,
});
