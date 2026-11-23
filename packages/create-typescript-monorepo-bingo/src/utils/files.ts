import type { IntakeDirectory, IntakeEntry } from 'bingo-fs';

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
 * Reads and parses a JSON file by slash-separated path in an intake directory.
 * Returns undefined for missing or unparseable files.
 */
export function readJson<T = Record<string, unknown>>(
  files: IntakeDirectory | undefined,
  filePath: string,
): T | undefined {
  const text = readText(files, filePath);
  if (text === undefined) {
    return undefined;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

/**
 * Reads a JSON file's text and parsed value, for blocks that round-trip its layout.
 */
export function readJsonFile(
  files: IntakeDirectory | undefined,
  filePath: string,
): undefined | { text: string; value: Record<string, unknown> } {
  const text = readText(files, filePath);
  const value = readJson(files, filePath);
  return text !== undefined && value ? { text, value } : undefined;
}

/**
 * Parses JSON text from an intake prop, or returns an empty object.
 */
export function parseJsonText(text: string | undefined): Record<string, unknown> {
  if (text === undefined) {
    return {};
  }

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}
