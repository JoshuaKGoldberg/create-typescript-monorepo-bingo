import { isDeepStrictEqual } from 'node:util';

import { applyEdits, type JSONPath, modify, parse as parseJsonc } from 'jsonc-parser';
import { sortPackageJson } from 'sort-package-json';

import { printValue, readJsonLayout } from './print.ts';

/**
 * Stringifies a value as JSON with a trailing newline.
 * Objects and arrays that exist in `existingText` keep their one-line or multi-line layout.
 */
export function formatJson(value: unknown, existingText?: string): string {
  // A file whose content doesn't change is written back exactly as it was.
  if (
    existingText !== undefined &&
    isDeepStrictEqual(parseJsonc(existingText, [], { allowTrailingComma: true }), value)
  ) {
    return existingText;
  }

  if (existingText !== undefined && !isStrictJson(existingText)) {
    return editJsonc(existingText, value);
  }

  return `${printValue(value, {
    indentUnit: detectIndent(existingText),
    layout: readJsonLayout(existingText),
    style: 'json',
  })}\n`;
}

/**
 * Detects an existing file's indentation, such as tabs, defaulting to two spaces.
 */
function detectIndent(text: string | undefined) {
  // The shallowest indentation is one level.
  const indents = [...(text ?? '').matchAll(/^([ \t]+)\S/gm)].map((match) => match[1]);
  return indents.sort((a, b) => a.length - b.length).at(0) ?? '  ';
}

/**
 * Edits JSONC text (with comments or trailing commas) in place to equal a value,
 * so comments and formatting outside the changed parts are kept.
 */
function editJsonc(text: string, value: unknown): string {
  let result = text;

  const visit = (path: JSONPath, before: unknown, after: unknown) => {
    if (isPlainObject(before) && isPlainObject(after)) {
      for (const key of Object.keys(before)) {
        if (!(key in after)) {
          result = applyEdits(result, modify(result, [...path, key], undefined, editOptions));
        }
      }
      for (const [key, child] of Object.entries(after)) {
        visit([...path, key], before[key], child);
      }
      return;
    }

    // Arrays are edited by index, so comments between existing items are kept.
    if (Array.isArray(before) && Array.isArray(after)) {
      for (let index = before.length - 1; index >= after.length; index -= 1) {
        result = applyEdits(result, modify(result, [...path, index], undefined, editOptions));
      }
      for (const [index, item] of after.entries()) {
        if (index < before.length) {
          visit([...path, index], before[index], item);
        } else {
          result = applyEdits(
            result,
            modify(result, [...path, index], item, { ...editOptions, isArrayInsertion: true }),
          );
        }
      }
      return;
    }

    if (!isDeepStrictEqual(before, after)) {
      result = applyEdits(result, modify(result, path, after, editOptions));
    }
  };

  visit([], parseJsonc(text, [], { allowTrailingComma: true }), value);
  return result;
}

const editOptions = { formattingOptions: { insertSpaces: true, tabSize: 2 } };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isStrictJson(text: string) {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Stringifies a package.json, sorted the way eslint-plugin-package-json expects.
 */
export function formatPackageJson(value: Record<string, unknown>, existingText?: string): string {
  // New manifests are sorted, and so are existing ones that already were; others keep
  // their key order.
  const cleaned = removeUndefined(value);
  const existing: unknown = existingText === undefined ? undefined : parseJsonc(existingText);
  if (existing === undefined) {
    return formatJson(sortPackageJson(cleaned), existingText);
  }

  // Only top-level keys are put in order: nested ones, like exports, may be in theirs on purpose.
  const ordered = hasSortedKeys(existing as Record<string, unknown>)
    ? Object.fromEntries(Object.keys(sortPackageJson(cleaned)).map((key) => [key, cleaned[key]]))
    : cleaned;
  return formatJson(ordered, existingText);
}

/**
 * Whether a manifest's top-level keys are in the order eslint-plugin-package-json expects.
 */
export function hasSortedKeys(manifest: Record<string, unknown>): boolean {
  return hasSameKeyOrder(manifest, sortPackageJson(manifest));
}

export function hasSameKeyOrder(a: object, b: object): boolean {
  return JSON.stringify(Object.keys(a)) === JSON.stringify(Object.keys(b));
}

/**
 * Sorts an object's keys alphabetically, as package.json collections expect.
 */
export function sortKeys<T>(value: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Sorts merged keys when the existing object's keys were already sorted, as lint rules
 * like package-json/sort-collections expect; otherwise keeps the merged order.
 */
export function keepSorted<T>(
  existing: Record<string, unknown> | undefined,
  merged: Record<string, T>,
): Record<string, T> {
  const keys = Object.keys(existing ?? {});
  const sorted =
    keys.length > 1 &&
    keys.every((key, index) => index === 0 || (keys[index - 1] ?? '').localeCompare(key) <= 0);
  return sorted ? sortKeys(merged) : merged;
}

/**
 * Creates an object with an existing object's keys first, in their order,
 * followed by any default keys the existing object doesn't have.
 */
export function withDefaults<T extends Record<string, unknown>>(
  existing: Record<string, unknown> | undefined,
  defaults: T,
): T {
  return existing ? ({ ...existing, ...omitKeys(defaults, Object.keys(existing)) } as T) : defaults;
}

/**
 * Removes undefined-valued keys from an object, shallowly.
 */
function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function omitKeys(value: Record<string, unknown>, keys: string[]) {
  const omitted = new Set(keys);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !omitted.has(key)));
}
