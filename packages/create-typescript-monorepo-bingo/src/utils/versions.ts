import semver from 'semver';
import { parse as parseYaml } from 'yaml';

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
 * A dependency the repository already has keeps its specifier: upgrades are Renovate's job,
 * and CTM never downgrades or narrows a range. The one exception is switching to a
 * different `npm:` alias target, like `typescript` becoming the TypeScript 6 wrapper,
 * which happens only from a version (or `^`/`~` range) of the same major version.
 * An alias to the dependency's own name, like `typescript: npm:typescript@^5`, counts as
 * a plain range.
 */
export function resolveSpecifier(
  existing: string | undefined,
  ours: string,
  dependency?: string,
): string {
  if (existing === undefined) {
    return ours;
  }

  if (isProtocolSpecifier(existing)) {
    return existing;
  }

  const existingAlias = getAlias(existing, dependency);
  const oursAlias = getAlias(ours, dependency);

  if (oursAlias && existingAlias?.name !== oursAlias.name) {
    return isSameMajorVersion(existingAlias?.range ?? existing, oursAlias.range) ? ours : existing;
  }

  return existing;
}

function isSameMajorVersion(existing: string, ours: string | undefined) {
  const match = /^[~^]?(\d+)\.\d+\.\d+(?:-[\w.]+)?$/.exec(existing.trim());
  const oursMinimum = minimumVersion(ours);
  return !!match && !!oursMinimum && Number(match[1]) === oursMinimum.major;
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

interface WorkspaceCatalogs {
  catalog?: Record<string, unknown>;
  catalogs?: Record<string, Record<string, unknown> | undefined>;
}

/**
 * Finds the lowest version a dependency's specifier allows, looking through catalog
 * references in pnpm-workspace.yaml and npm aliases, like npm:typescript@^5.9.3.
 */
export function getMinimumVersion(
  name: string,
  specifier: string | undefined,
  workspaceText: string | undefined,
): semver.SemVer | undefined {
  if (specifier?.startsWith('catalog:')) {
    let workspace: undefined | WorkspaceCatalogs;
    try {
      workspace = parseYaml(workspaceText ?? '') as undefined | WorkspaceCatalogs;
    } catch {
      return undefined;
    }

    const catalogName = specifier.slice('catalog:'.length) || 'default';
    const resolved =
      catalogName === 'default'
        ? (workspace?.catalog?.[name] ?? workspace?.catalogs?.default?.[name])
        : workspace?.catalogs?.[catalogName]?.[name];
    return typeof resolved === 'string' && !resolved.startsWith('catalog:')
      ? getMinimumVersion(name, resolved, undefined)
      : undefined;
  }

  const range = parseNpmAlias(specifier ?? '')?.range ?? specifier;
  return range && semver.validRange(range) ? (semver.minVersion(range) ?? undefined) : undefined;
}
