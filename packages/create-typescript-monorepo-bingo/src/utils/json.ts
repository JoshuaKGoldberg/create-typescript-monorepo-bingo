import { sortPackageJson } from 'sort-package-json';

import { printValue, readJsonLayout } from './print.ts';

/**
 * Stringifies a value as JSON with a trailing newline.
 * Objects and arrays that exist in `existingText` keep their one-line or multi-line layout.
 */
export function formatJson(value: unknown, existingText?: string): string {
  return `${printValue(value, { layout: readJsonLayout(existingText), style: 'json' })}\n`;
}

/**
 * Stringifies a package.json, sorted the way eslint-plugin-package-json expects.
 */
export function formatPackageJson(value: Record<string, unknown>, existingText?: string): string {
  return formatJson(sortPackageJson(removeUndefined(value)), existingText);
}

/**
 * Sorts an object's keys alphabetically, as package.json collections expect.
 */
export function sortKeys<T>(value: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
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
export function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function omitKeys(value: Record<string, unknown>, keys: string[]) {
  const omitted = new Set(keys);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !omitted.has(key)));
}
