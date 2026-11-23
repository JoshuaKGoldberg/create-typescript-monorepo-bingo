import type { IntakeDirectory, IntakeEntry } from 'bingo-fs';
import { type ParseError, parse as parseJsonc } from 'jsonc-parser';

/**
 * Finds an entry by slash-separated path in an intake directory.
 */
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

/**
 * Finds a directory by slash-separated path in an intake directory.
 */
export function getDirectory(
  files: IntakeDirectory | undefined,
  directoryPath: string,
): IntakeDirectory | undefined {
  const entry = getEntry(files, directoryPath);
  return entry && !Array.isArray(entry) ? entry : undefined;
}

/**
 * Reads a file's text by slash-separated path in an intake directory.
 */
export function readText(files: IntakeDirectory | undefined, filePath: string): string | undefined {
  const entry = getEntry(files, filePath);
  return Array.isArray(entry) ? entry[0] : undefined;
}

/**
 * Reads and parses a JSON (or JSONC, with comments and trailing commas) file by
 * slash-separated path in an intake directory. Returns undefined for missing files.
 * @throws If the file exists but can't be parsed, so it's never mistaken for empty.
 */
export function readJson(
  files: IntakeDirectory | undefined,
  filePath: string,
): Record<string, unknown> | undefined {
  const text = readText(files, filePath);
  return text === undefined ? undefined : parseJsonText(text, filePath);
}

/**
 * Parses JSON or JSONC text from an intake prop, or returns an empty object for none.
 * @throws If the text can't be parsed, so a file is never mistaken for empty and wiped.
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
 * Other file names tools read their config from, which CTM doesn't write itself.
 * If a repository uses one, CTM leaves it alone rather than add a second, competing file.
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
  oxfmt: ['.oxfmtrc.json', '.oxfmtrc.jsonc', 'oxfmt.config.js', 'oxfmt.config.mjs'],
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

/**
 * Finds which alternate config file, if any, a repository has for a tool.
 */
export function findAlternateConfig(
  files: IntakeDirectory | undefined,
  tool: keyof typeof alternateConfigFiles,
): string | undefined {
  return alternateConfigFiles[tool].find((name) => getEntry(files, name) !== undefined);
}

/**
 * Creates the suggestion shown when CTM leaves an alternate config file alone.
 */
function describeAlternateConfig(alternate: string, ours: string): string {
  return `Found ${alternate}, so ${ours} wasn't written. Move its settings to ${ours} and delete it to have create-typescript-monorepo-bingo manage it.`;
}

/**
 * Drops a file from a Block's creation when the repository uses an alternate config file,
 * and suggests how to move to CTM's.
 */
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

  // The repository configures the tool itself, so its dependencies, scripts and CI jobs
  // aren't CTM's to add either.
  return {
    ...creation,
    extensions: [],
    files,
    suggestions: [...(creation.suggestions ?? []), describeAlternateConfig(alternate, filePath)],
  };
}

/**
 * The first line of files CTM owns entirely. An existing file without it is the
 * repository's own, and is left alone with a suggestion, so nothing is overwritten
 * without the repository opting in.
 */
export const ownedFileMarker =
  '// Managed by create-typescript-monorepo-bingo: changes here are replaced on transitions.';

/**
 * Whether CTM may write an owned file: it's new, or it carries the marker.
 */
export function isOwnedFile(text: string | undefined): boolean {
  return text === undefined || text.startsWith(ownedFileMarker);
}

/**
 * Creates the suggestion shown when CTM leaves an unmarked owned file alone.
 */
export function describeUnownedFile(filePath: string): string {
  return `${filePath} wasn't created by create-typescript-monorepo-bingo, so it wasn't replaced. Delete it, or add "${ownedFileMarker}" as its first line, to have it managed.`;
}
