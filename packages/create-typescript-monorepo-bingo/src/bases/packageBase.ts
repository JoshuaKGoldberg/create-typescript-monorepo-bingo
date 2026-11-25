import { createBase } from 'bingo-stratum';

import { packageOptionsShape } from '../options.ts';

export const packageBase = createBase({
  options: packageOptionsShape,
});
