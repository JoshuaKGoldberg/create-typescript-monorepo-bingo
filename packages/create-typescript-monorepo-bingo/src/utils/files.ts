import type { IntakeDirectory, IntakeEntry } from 'bingo-fs';
import { type ParseError, parse as parseJsonc } from 'jsonc-parser';

export function getEntry(
  files: IntakeDirectory | undefined,
  filePath: string,
): IntakeEntry | undefined {
  let current: IntakeEntry | undefined = files;

  for (const segment of filePath.split('/')) {
    if (!current || Array.isArray(current)) {
      return undefined;
    }

    current = current[segment];
  }

  return current;
}

export function getDirectory(
  files: IntakeDirectory | undefined,
  directoryPath: string,
): IntakeDirectory | undefined {
  const entry = getEntry(files, directoryPath);
  return entry && !Array.isArray(entry) ? entry : undefined;
}

export function readText(files: IntakeDirectory | undefined, filePath: string): string | undefined {
  const entry = getEntry(files, filePath);
  return Array.isArray(entry) ? entry[0] : undefined;
}

/**
 * @throws If the file can't be parsed, so that it isn't mistaken for empty.
 */
export function readJson(
  files: IntakeDirectory | undefined,
  filePath: string,
): Record<string, unknown> | undefined {
  const text = readText(files, filePath);
  return text === undefined ? undefined : parseJsonText(text, filePath);
}

/**
 * @throws If the text can't be parsed, so that it isn't mistaken for empty.
 */
export function parseJsonText(
  text: string | undefined,
  filePath = 'a JSON file',
): Record<string, unknown> {
  if (text === undefined) {
    return {};
  }

  const errors: ParseError[] = [];
  const value = parseJsonc(text, errors, { allowTrailingComma: true }) as unknown;
  if (errors.length || !value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Could not parse ${filePath} as a JSON object. Fix or remove it, then re-run.`);
  }

  return value as Record<string, unknown>;
}

/**
 * Other config files that tools read, which CTM avoids competing with.
 */
export const alternateConfigFiles = {
  cspell: [
    '.cspell.json',
    'cSpell.json',
    'cspell.config.json',
    'cspell.config.yaml',
    'cspell.yaml',
  ],
  eslint: [
    'eslint.config.cjs',
    'eslint.config.cts',
    'eslint.config.js',
    'eslint.config.mjs',
    'eslint.config.mts',
  ],
  knip: [
    '.knip.json',
    '.knip.jsonc',
    'knip.config.js',
    'knip.config.mjs',
    'knip.js',
    'knip.json',
    'knip.jsonc',
    'knip.ts',
  ],
  oxfmt: [
    '.oxfmtrc.json',
    '.oxfmtrc.jsonc',
    'oxfmt.config.js',
    'oxfmt.config.mjs',
    'oxfmt.config.mts',
  ],
  renovate: [
    '.github/renovate.json5',
    '.renovaterc',
    '.renovaterc.json',
    '.renovaterc.json5',
    'renovate.json',
    'renovate.json5',
  ],
  vitest: [
    'vite.config.js',
    'vite.config.mjs',
    'vite.config.mts',
    'vite.config.ts',
    'vitest.config.js',
    'vitest.config.mjs',
    'vitest.config.mts',
  ],
} as const;

export function findAlternateConfig(
  files: IntakeDirectory | undefined,
  tool: keyof typeof alternateConfigFiles,
): string | undefined {
  return alternateConfigFiles[tool].find((name) => getEntry(files, name) !== undefined);
}

function describeAlternateConfig(alternate: string, ours: string): string {
  return `${ours} wasn't added because ${alternate} already exists. Move its settings to ${ours} and delete it to have it managed.`;
}

export function withoutAlternate<Creation extends { files?: object; suggestions?: string[] }>(
  alternate: string | undefined,
  filePath: string,
  creation: Creation,
): Creation {
  if (!alternate || !creation.files) {
    return creation;
  }

  const files = structuredClone(creation.files) as Record<string, unknown>;
  const segments = filePath.split('/');
  const fileName = segments.pop() ?? filePath;
  let directory: Record<string, unknown> | undefined = files;
  for (const segment of segments) {
    directory = directory[segment] as Record<string, unknown> | undefined;
    if (!directory) {
      return creation;
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete directory[fileName];

  // The tool's dependencies, scripts, and CI jobs aren't managed either
  return {
    ...creation,
    extensions: [],
    files,
    suggestions: [...(creation.suggestions ?? []), describeAlternateConfig(alternate, filePath)],
  };
}

/**
 * Existing files without this line are left alone.
 */
export const ownedFileMarker =
  '// Managed by create-typescript-monorepo-bingo: changes here are replaced on transitions.';

export function isOwnedFile(text: string | undefined): boolean {
  // Import sorting can move imports above the marker
  return text === undefined || text.split('\n').some((line) => line.trim() === ownedFileMarker);
}

export function describeUnownedFile(filePath: string): string {
  return `${filePath} already exists, so it wasn't replaced. Delete it or add a "${ownedFileMarker}" line at its top to have it managed.`;
}
