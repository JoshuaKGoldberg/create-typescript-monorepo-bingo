import { z } from 'zod';

import { packageBase } from '../../bases/packageBase.ts';
import { getEntry } from '../../utils/files.ts';

/**
 * Creates a new package's README and starter source and test files.
 * Packages that already have them keep theirs.
 */
export const blockPackageStarter = packageBase.createBlock({
  about: {
    name: 'Package Starter',
  },
  intake({ files }) {
    return {
      hasReadme: getEntry(files, 'README.md') !== undefined,
      hasSource: getEntry(files, 'src') !== undefined,
    };
  },
  props: {
    hasReadme: z.boolean().optional(),
    hasSource: z.boolean().optional(),
  },
  produce({ options, props }) {
    const { package: pkg } = options;

    return {
      files: {
        ...(!props.hasReadme && {
          'README.md': `# ${pkg.name}\n\n${pkg.description ?? options.description}\n\n## Usage\n\n\`\`\`shell\nnpm i ${pkg.name}\n\`\`\`\n\n\`\`\`ts\nimport { greet } from '${pkg.name}';\n\ngreet('world');\n\`\`\`\n`,
        }),
        ...(!props.hasSource && {
          src: {
            'greet.test.ts': `import { describe, expect, it } from 'vitest';

import { greet } from './greet.ts';

describe(greet, () => {
  it('greets the name', () => {
    expect(greet('world')).toBe('Hello, world!');
  });
});
`,
            'greet.ts': `/**
 * Creates a greeting for a name.
 * @param name Who to greet.
 * @returns The greeting.
 */
export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}
`,
            'index.ts': `export { greet } from './greet.ts';\n`,
          },
        }),
      },
    };
  },
});
