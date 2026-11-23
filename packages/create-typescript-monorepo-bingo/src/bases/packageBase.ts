import { createBase } from 'bingo-stratum';

import { packageOptionsShape } from '../options.ts';

/**
 * The Base for per-package Blocks. Its options are the root options plus the package.
 */
export const packageBase = createBase({
  options: packageOptionsShape,
});
