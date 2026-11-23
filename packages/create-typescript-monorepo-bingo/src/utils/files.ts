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
export function readJson(
  files: IntakeDirectory | undefined,
  filePath: string,
): Record<string, unknown> | undefined {
  const text = readText(files, filePath);
  if (text === undefined) {
    return undefined;
  }

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return undefined;
  }
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
