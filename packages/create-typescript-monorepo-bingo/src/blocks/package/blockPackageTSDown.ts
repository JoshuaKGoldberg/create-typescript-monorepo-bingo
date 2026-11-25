import { z } from 'zod';

import { packageBase } from '../../bases/packageBase.ts';
import { readText } from '../../utils/files.ts';
import { getBuildPackageName } from '../../utils/options.ts';

export const blockPackageTSDown = packageBase.createBlock({
  about: {
    name: 'Package tsdown',
  },
  intake({ files }) {
    const existing = readText(files, 'tsdown.config.ts');
    return existing === undefined ? undefined : { existing };
  },
  props: {
    existing: z.string().optional(),
  },
  produce({ options, props }) {
    return {
      files: {
        'tsdown.config.ts':
          props.existing ??
          `import { base } from '${getBuildPackageName(options)}/tsdown';
import { defineConfig, type UserConfig } from 'tsdown';

const config: UserConfig = defineConfig({
  ...base,
});

export default config;
`,
      },
    };
  },
});
