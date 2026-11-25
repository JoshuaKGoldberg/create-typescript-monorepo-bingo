/**
 * Existing lists keep their order, unless `compare` is provided and they were already sorted.
 */
export function mergeList(
  existing: readonly string[] | undefined,
  additions: readonly string[],
  compare?: (a: string, b: string) => number,
): string[] {
  if (!existing) {
    return [...new Set(additions)].sort(compare);
  }

  const sorter = compare ?? compareCodeUnits;
  const sorted =
    existing.length > 1 &&
    existing.every((item, index) => index === 0 || sorter(existing[index - 1] ?? '', item) <= 0);
  const merged = [...new Set([...existing, ...additions])];
  return sorted && compare ? merged.sort(compare) : merged;
}

export function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compareCaseInsensitive(a: string, b: string): number {
  return a.localeCompare(b, 'en', { sensitivity: 'base' });
}
