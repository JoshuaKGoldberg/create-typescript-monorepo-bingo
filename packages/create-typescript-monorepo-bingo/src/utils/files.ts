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
