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
  if (!existing) {
    return [...new Set(additions)].sort(compare);
  }

  // A list that's already sorted stays sorted.
  const sorter = compare ?? ((a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0));
  const sorted =
    existing.length > 1 &&
    existing.every((item, index) => index === 0 || sorter(existing[index - 1] ?? '', item) <= 0);
  const merged = [...new Set([...existing, ...additions])];
  return sorted && compare ? merged.sort(compare) : merged;
}

/**
 * Compares case-insensitively, for word lists.
 */
export function compareCaseInsensitive(a: string, b: string): number {
  return a.localeCompare(b, 'en', { sensitivity: 'base' });
}
