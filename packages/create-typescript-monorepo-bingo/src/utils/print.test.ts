import { describe, expect, it } from 'vitest';

import { formatJson } from './json.ts';
import { printValue, readJsonLayout } from './print.ts';

describe(formatJson, () => {
  it('expands objects and keeps short primitive arrays inline by default', () => {
    expect(formatJson({ include: ['src'], options: { strict: true } })).toBe(`{
  "include": ["src"],
  "options": {
    "strict": true
  }
}
`);
  });

  it('keeps the layout of an existing file', () => {
    const existing = `{
  "changelog": ["@changesets/changelog-github", { "repo": "a/b" }],
  "references": [
    { "path": "./packages/a" },
    { "path": "./packages/b" }
  ]
}
`;

    expect(formatJson(JSON.parse(existing), existing)).toBe(existing);
  });

  it('gives new array elements the layout of their siblings', () => {
    const existing = `{
  "references": [
    { "path": "./a" }
  ]
}
`;

    expect(formatJson({ references: [{ path: './a' }, { path: './b' }] }, existing)).toBe(`{
  "references": [
    { "path": "./a" },
    { "path": "./b" }
  ]
}
`);
  });
});

describe(printValue, () => {
  it('prints TypeScript objects inline when they fit', () => {
    expect(
      printValue(
        { overrides: [{ files: ['.nvmrc'], options: { parser: 'yaml' } }] },
        { style: 'ts' },
      ),
    ).toBe(`{
  overrides: [
    {
      files: ['.nvmrc'],
      options: { parser: 'yaml' },
    },
  ],
}`);
  });

  it('quotes keys that are not identifiers', () => {
    expect(printValue({ '.': { a: 1 } }, { style: 'ts' })).toBe(`{
  '.': { a: 1 },
}`);
  });
});

describe(readJsonLayout, () => {
  it('returns undefined for invalid JSON', () => {
    expect(readJsonLayout('{')).toBeUndefined();
  });
});
