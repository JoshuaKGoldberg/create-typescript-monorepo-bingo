import { createBase } from 'bingo-stratum';

import { rootOptionsShape } from '../options.ts';

export const rootBase = createBase({
  options: rootOptionsShape,
});
