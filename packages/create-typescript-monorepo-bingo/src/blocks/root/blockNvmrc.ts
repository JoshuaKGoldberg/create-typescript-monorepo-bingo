import { rootBase } from '../../bases/rootBase.ts';
import { defaults } from '../../options.ts';

export const blockNvmrc = rootBase.createBlock({
  about: {
    name: 'nvmrc',
  },
  produce({ options }) {
    return {
      files: {
        '.nvmrc': `${options.node ?? defaults.node}\n`,
      },
    };
  },
});
