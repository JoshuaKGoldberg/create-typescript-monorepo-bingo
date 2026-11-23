import semver from 'semver';

const protocolPrefixes = [
  'catalog:',
  'file:',
  'git+',
  'git:',
  'github:',
  'http:',
  'https:',
  'jsr:',
  'link:',
  'portal:',
  'workspace:',
];

export interface NpmAlias {
  name: string;
  range: string | undefined;
}

/**
 * Whether a specifier is something CTM never rewrites: a protocol such as `catalog:`
 * or `workspace:`, a local path or tarball, or a git shorthand like `owner/repo#ref`.
 */
export function isProtocolSpecifier(specifier: string): boolean {
  return (
    protocolPrefixes.some((prefix) => specifier.startsWith(prefix)) ||
    /^(?:git@|gitlab:|bitbucket:|ssh:\/\/|git\+ssh:)/.test(specifier) ||
    /^(?:\.{0,2}\/|~\/)/.test(specifier) ||
    specifier.endsWith('.tgz') ||
    /^[\w.-]+\/[\w.-]+(?:#.*)?$/.test(specifier)
  );
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
 * 1. Protocol specifiers on disk (`catalog:`, `workspace:`, git, paths) stay as they are.
 * 2. `npm:` aliases: the same target compares ranges; a different target means CTM's wins.
 *    An alias to the dependency's own name, like `typescript: npm:typescript@^5`, counts
 *    as a plain range.
 * 3. Plain ranges: CTM's wins only when the range on disk doesn't already allow CTM's
 *    version and starts lower, so Renovate bumps are never undone and ranges never narrow.
 *    A specifier on disk that isn't a range, such as a dist-tag, is kept.
 */
export function resolveSpecifier(
  existing: string | undefined,
  ours: string,
  dependency?: string,
): string {
  if (existing === undefined || existing === ours) {
    return ours;
  }

  if (isProtocolSpecifier(existing)) {
    return existing;
  }

  const existingAlias = getAlias(existing, dependency);
  const oursAlias = getAlias(ours, dependency);

  if (existingAlias || oursAlias) {
    if (existingAlias?.name !== oursAlias?.name) {
      // A different target, like \`typescript\` becoming the TypeScript 6 wrapper, wins
      // unless what's on disk is a newer major version, which it would downgrade.
      return isNewerMajor(existingAlias?.range ?? existing, oursAlias?.range ?? ours)
        ? existing
        : ours;
    }

    return isUpgrade(existingAlias?.range, oursAlias?.range) ? ours : existing;
  }

  return isUpgrade(existing, ours) ? ours : existing;
}

function isNewerMajor(existing: string, ours: string) {
  const existingMinimum = minimumVersion(existing);
  const oursMinimum = minimumVersion(ours);
  return !!existingMinimum && !!oursMinimum && existingMinimum.major > oursMinimum.major;
}

/**
 * Picks the larger of two specifiers that both describe the same dependency,
 * such as two catalog entries for one name. Unlike {@link resolveSpecifier},
 * neither side is privileged; ties keep the first.
 */
export function largerSpecifier(first: string, second: string, dependency?: string): string {
  const firstAlias = getAlias(first, dependency);
  const secondAlias = getAlias(second, dependency);

  if (firstAlias || secondAlias) {
    if (firstAlias?.name !== secondAlias?.name) {
      return second;
    }

    return hasLargerMinimum(secondAlias?.range, firstAlias?.range) ? second : first;
  }

  return hasLargerMinimum(second, first) ? second : first;
}

/**
 * Gets an alias's target, treating an alias to the dependency itself as a plain range.
 */
function getAlias(specifier: string, dependency: string | undefined) {
  const alias = parseNpmAlias(specifier);
  return alias && alias.name === dependency ? undefined : alias;
}

/**
 * Whether moving from `baseline` to `candidate` is an upgrade: `baseline` is a range
 * that doesn't include `candidate`'s minimum version, and starts lower than it.
 */
function isUpgrade(baseline: string | undefined, candidate: string | undefined): boolean {
  const candidateMinimum = minimumVersion(candidate);
  if (!candidateMinimum) {
    return false;
  }

  if (!baseline) {
    return true;
  }

  const baselineMinimum = minimumVersion(baseline);
  if (!baselineMinimum) {
    return false;
  }

  // Only an upgrade if the baseline allows no version as high: \`^5 || ^27\` already
  // allows newer versions than 26, so it isn't replaced by 26.
  return semver.gtr(candidateMinimum, baseline, { includePrerelease: true });
}

function hasLargerMinimum(candidate: string | undefined, baseline: string | undefined) {
  const candidateMinimum = minimumVersion(candidate);
  const baselineMinimum = minimumVersion(baseline);
  return !!candidateMinimum && (!baselineMinimum || semver.gt(candidateMinimum, baselineMinimum));
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
