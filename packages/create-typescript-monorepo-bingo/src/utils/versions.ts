import semver from 'semver';

const protocolPrefixes = [
  'catalog:',
  'file:',
  'git+',
  'git:',
  'github:',
  'http:',
  'https:',
  'link:',
  'portal:',
  'workspace:',
];

export interface NpmAlias {
  name: string;
  range: string | undefined;
}

/**
 * Whether a specifier uses a protocol that CTM never rewrites,
 * such as `catalog:` or `workspace:`.
 */
export function isProtocolSpecifier(specifier: string): boolean {
  return protocolPrefixes.some((prefix) => specifier.startsWith(prefix));
}

/**
 * Parses an `npm:&lt;name>@&lt;range>` alias, splitting at the last `@`.
 * A last `@` at index 0 (as in `npm:@scope/name`) means there's no range.
 */
export function parseNpmAlias(specifier: string): NpmAlias | undefined {
  if (!specifier.startsWith('npm:')) {
    return undefined;
  }

  const body = specifier.slice('npm:'.length);
  const at = body.lastIndexOf('@');

  return at <= 0
    ? { name: body, range: undefined }
    : { name: body.slice(0, at), range: body.slice(at + 1) };
}

/**
 * Picks the specifier to write for a dependency, given what's on disk and what CTM pins.
 * In order:
 * 1. Protocol specifiers on disk (`catalog:`, `workspace:`, ...) stay as they are.
 * 2. `npm:` aliases: same target name compares ranges; a different target means CTM's wins.
 * 3. Plain ranges: CTM's wins only with a larger minimum version, so Renovate bumps are
 *    never undone, and a different style of the same version (`^1.2.3`) stays.
 */
export function resolveSpecifier(existing: string | undefined, ours: string): string {
  if (existing === undefined || existing === ours) {
    return ours;
  }

  if (isProtocolSpecifier(existing)) {
    return existing;
  }

  const existingAlias = parseNpmAlias(existing);
  const oursAlias = parseNpmAlias(ours);

  if (existingAlias || oursAlias) {
    if (existingAlias?.name !== oursAlias?.name) {
      return ours;
    }

    // Both are aliases to the same package.
    return isLargerRange(oursAlias?.range, existingAlias?.range) ? ours : existing;
  }

  return isLargerRange(ours, existing) ? ours : existing;
}

/**
 * Picks the larger of two specifiers that both describe the same dependency,
 * such as two catalog entries for one name. Unlike {@link resolveSpecifier},
 * neither side is privileged; ties keep the first.
 */
export function largerSpecifier(first: string, second: string): string {
  const firstAlias = parseNpmAlias(first);
  const secondAlias = parseNpmAlias(second);

  if (firstAlias || secondAlias) {
    if (firstAlias?.name !== secondAlias?.name) {
      return second;
    }

    return isLargerRange(secondAlias?.range, firstAlias?.range) ? second : first;
  }

  return isLargerRange(second, first) ? second : first;
}

/**
 * Whether `candidate` has a strictly larger minimum version than `baseline`.
 * Unparseable ranges are never considered larger.
 */
function isLargerRange(candidate: string | undefined, baseline: string | undefined): boolean {
  const candidateMinimum = minimumVersion(candidate);
  if (!candidateMinimum) {
    return false;
  }

  const baselineMinimum = minimumVersion(baseline);
  if (!baselineMinimum) {
    return true;
  }

  return semver.gt(candidateMinimum, baselineMinimum);
}

function minimumVersion(range: string | undefined) {
  if (!range) {
    return undefined;
  }

  try {
    return semver.minVersion(range) ?? undefined;
  } catch {
    return undefined;
  }
}
