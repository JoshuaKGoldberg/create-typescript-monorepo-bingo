import { describe, expect, it } from 'vitest';

import {
  printStatic,
  readConfigLayout,
  readConfigObject,
  readESLintIgnoresWithSource,
} from './staticConfig.ts';

describe(readConfigObject, () => {
  it('reads a defineConfig() object', () => {
    expect(
      readConfigObject(`import { defineConfig } from 'oxfmt';

const config = defineConfig({
  ignorePatterns: ['coverage'],
  singleQuote: true,
});

export default config;
`),
    ).toEqual({ ignorePatterns: ['coverage'], singleQuote: true });
  });

  it('reads a typed object with regular expressions', () => {
    expect(
      readConfigObject(`const config: KnipConfig = { ignoreDependencies: [/^@types\\//] };
export default config;`),
    ).toEqual({ ignoreDependencies: [{ regex: '/^@types\\//' }] });
  });

  it('gives up on values it cannot evaluate', () => {
    expect(readConfigObject(`export default { ...other };`)).toBeUndefined();
    expect(readConfigObject(`export default { a: process.env.A };`)).toBeUndefined();
  });

  it('round-trips through printStatic with its layout', () => {
    const source = `const config = {
  ignoreExportsUsedInFile: { interface: true, type: true },
  workspaces: {
    'packages/a': {
      project: ['src/**/*.ts!'],
    },
  },
};`;
    const value = readConfigObject(`${source}\nexport default config;`);

    expect(value && printStatic(value, readConfigLayout(`${source}\nexport default config;`))).toBe(
      source.slice('const config = '.length, -1),
    );
  });
});

describe(readESLintIgnoresWithSource, () => {
  it('reads global ignores with comments, but not file-specific ignores', () => {
    expect(
      readESLintIgnoresWithSource(`export default defineConfig(
  {
    ignores: [
      'coverage',
      // Remove after #527
      'packages/*/bin/*.js',
    ],
  },
  { files: ['**/*.md'], ignores: ['CHANGELOG.md'] },
);`),
    ).toEqual({
      lines: ["      'coverage',", '      // Remove after #527', "      'packages/*/bin/*.js',"],
      values: ['coverage', 'packages/*/bin/*.js'],
    });
  });
});
