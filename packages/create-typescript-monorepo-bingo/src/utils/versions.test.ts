import { describe, expect, it } from 'vitest';

import {
  isProtocolSpecifier,
  largerSpecifier,
  parseNpmAlias,
  resolveSpecifier,
} from './versions.ts';

describe(parseNpmAlias, () => {
  it.each([
    ['npm:@typescript/typescript6@6.0.2', { name: '@typescript/typescript6', range: '6.0.2' }],
    ['npm:typescript@7.0.2', { name: 'typescript', range: '7.0.2' }],
    ['npm:@typescript/typescript6', { name: '@typescript/typescript6', range: undefined }],
    ['npm:typescript', { name: 'typescript', range: undefined }],
  ])('parses %s', (specifier, expected) => {
    expect(parseNpmAlias(specifier)).toEqual(expected);
  });

  it('returns undefined for a plain range', () => {
    expect(parseNpmAlias('^6.0.3')).toBeUndefined();
  });
});

describe(isProtocolSpecifier, () => {
  it.each(['catalog:', 'catalog:dev', 'workspace:^', 'link:../a', 'file:../a', 'github:a/b'])(
    'is true for %s',
    (specifier) => {
      expect(isProtocolSpecifier(specifier)).toBe(true);
    },
  );

  it.each(['1.2.3', '^1.2.3', 'npm:typescript@7.0.2'])('is false for %s', (specifier) => {
    expect(isProtocolSpecifier(specifier)).toBe(false);
  });
});

describe(resolveSpecifier, () => {
  it('uses ours when nothing exists', () => {
    expect(resolveSpecifier(undefined, '1.2.3')).toBe('1.2.3');
  });

  it('keeps a protocol specifier on disk', () => {
    expect(resolveSpecifier('catalog:react18', '19.0.0')).toBe('catalog:react18');
    expect(resolveSpecifier('workspace:^', '1.0.0')).toBe('workspace:^');
  });

  it("replaces bingo's root typescript with the TypeScript 6 alias", () => {
    expect(resolveSpecifier('6.0.3', 'npm:@typescript/typescript6@6.0.2')).toBe(
      'npm:@typescript/typescript6@6.0.2',
    );
  });

  it("replaces bingo's build package ~6.0.3 with the TypeScript 6 alias", () => {
    expect(resolveSpecifier('~6.0.3', 'npm:@typescript/typescript6@6.0.2')).toBe(
      'npm:@typescript/typescript6@6.0.2',
    );
  });

  it('keeps a Renovate-bumped typescript6 alias over an older pin', () => {
    expect(
      resolveSpecifier('npm:@typescript/typescript6@6.0.4', 'npm:@typescript/typescript6@6.0.2'),
    ).toBe('npm:@typescript/typescript6@6.0.4');
  });

  it('keeps a Renovate-bumped typescript 7 alias over an older pin', () => {
    expect(resolveSpecifier('npm:typescript@7.0.4', 'npm:typescript@7.0.2')).toBe(
      'npm:typescript@7.0.4',
    );
  });

  it('keeps a newer prerelease alias, as flint has', () => {
    expect(resolveSpecifier('npm:typescript@7.1.0-dev.20261101', 'npm:typescript@7.0.2')).toBe(
      'npm:typescript@7.1.0-dev.20261101',
    );
  });

  it('upgrades an older alias range', () => {
    expect(resolveSpecifier('npm:typescript@7.0.1', 'npm:typescript@7.0.2')).toBe(
      'npm:typescript@7.0.2',
    );
  });

  it('uses ours when an alias points at a different package', () => {
    expect(resolveSpecifier('npm:other@9.9.9', 'npm:typescript@7.0.2')).toBe(
      'npm:typescript@7.0.2',
    );
  });

  it('keeps a larger plain version', () => {
    expect(resolveSpecifier('5.2.0', '5.1.1')).toBe('5.2.0');
  });

  it('upgrades a smaller plain version', () => {
    expect(resolveSpecifier('5.0.0', '5.1.1')).toBe('5.1.1');
  });

  it('keeps an equal version with a different style', () => {
    expect(resolveSpecifier('^5.1.1', '5.1.1')).toBe('^5.1.1');
  });

  it('keeps an unparseable specifier rather than guessing', () => {
    expect(resolveSpecifier('latest', '5.1.1')).toBe('5.1.1');
  });
});

describe(largerSpecifier, () => {
  it('keeps the first on a tie', () => {
    expect(largerSpecifier('0.23.7', '^0.23.7')).toBe('0.23.7');
  });

  it('takes the larger', () => {
    expect(largerSpecifier('1.0.0', '1.1.0')).toBe('1.1.0');
  });

  it('compares aliases to the same package by range', () => {
    expect(largerSpecifier('npm:typescript@7.0.4', 'npm:typescript@7.0.2')).toBe(
      'npm:typescript@7.0.4',
    );
  });
});
