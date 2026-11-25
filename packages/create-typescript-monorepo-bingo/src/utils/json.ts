import { isDeepStrictEqual } from 'node:util';

import { applyEdits, type JSONPath, modify, parse as parseJsonc } from 'jsonc-parser';
import { sortPackageJson } from 'sort-package-json';

import { printValue, readJsonLayout } from './print.ts';

export function formatJson(value: unknown, existingText?: string): string {
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

function detectIndent(text: string | undefined) {
  const indents = [...(text ?? '').matchAll(/^([ \t]+)\S/gm)].map((match) => match[1]);
  return indents.sort((a, b) => a.length - b.length).at(0) ?? '  ';
}

/**
 * Edits in place so that comments and formatting are kept.
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

    // Edited by index to keep comments between items
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

export function formatPackageJson(value: Record<string, unknown>, existingText?: string): string {
  // Existing manifests that weren't sorted keep their order
  const cleaned = removeUndefined(value);
  const existing: unknown = existingText === undefined ? undefined : parseJsonc(existingText);
  if (existing === undefined) {
    return formatJson(sortPackageJson(cleaned), existingText);
  }

  // Nested keys, such as exports, may be intentionally ordered
  const ordered = hasSortedKeys(existing as Record<string, unknown>)
    ? Object.fromEntries(Object.keys(sortPackageJson(cleaned)).map((key) => [key, cleaned[key]]))
    : cleaned;
  return formatJson(ordered, existingText);
}

export function hasSortedKeys(manifest: Record<string, unknown>): boolean {
  return hasSameKeyOrder(manifest, sortPackageJson(manifest));
}

export function hasSameKeyOrder(a: object, b: object): boolean {
  return JSON.stringify(Object.keys(a)) === JSON.stringify(Object.keys(b));
}

export function sortKeys<T>(value: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
}

export function hasSortedKeysDeep(value: unknown): boolean {
  return JSON.stringify(value) === JSON.stringify(sortKeysDeep(value));
}

export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }

  return isPlainObject(value)
    ? Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([key, child]) => [key, sortKeysDeep(child)]),
      )
    : value;
}

export function mergeScripts(
  existing: Record<string, string> | undefined,
  ours: Record<string, string>,
): Record<string, string> {
  const merged = { ...existing, ...omitKeys(ours, Object.keys(existing ?? {})) } as Record<
    string,
    string
  >;
  return hasSameKeyOrder(existing ?? {}, sortScripts(existing ?? {}))
    ? sortScripts(merged)
    : merged;
}

function sortScripts(scripts: Record<string, string>): Record<string, string> {
  // sort-package-json leaves scripts alone next to some dependencies
  return sortPackageJson({ scripts }).scripts;
}

export function withDefaults<T extends Record<string, unknown>>(
  existing: Record<string, unknown> | undefined,
  defaults: T,
): T {
  return existing ? ({ ...existing, ...omitKeys(defaults, Object.keys(existing)) } as T) : defaults;
}

function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

export function omitKeys(value: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const omitted = new Set(keys);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !omitted.has(key)));
}
