/**
 * Merges entries into a list from an existing file.
 * An existing list keeps its order, with new entries appended, so hand-ordered
 * files don't churn; a new list is sorted.
 */
export function mergeList(
  existing: readonly string[] | undefined,
  additions: readonly string[],
  compare?: (a: string, b: string) => number,
): string[] {
  return existing
    ? [...new Set([...existing, ...additions])]
    : [...new Set(additions)].sort(compare);
}

/**
 * Compares case-insensitively, for word lists.
 */
export function compareCaseInsensitive(a: string, b: string): number {
  return a.localeCompare(b, 'en', { sensitivity: 'base' });
}
