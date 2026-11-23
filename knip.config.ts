import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  ignoreExportsUsedInFile: { interface: true, type: true },
  workspaces: {
    '.': {
      ignoreDependencies: ['@changesets/cli'],
    },
    'packages/pins': {
      ignoreDependencies: [/.+/],
    },
  },
};

export default config;
