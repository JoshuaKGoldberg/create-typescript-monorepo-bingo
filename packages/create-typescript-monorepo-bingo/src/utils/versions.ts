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
 * Whether a specifier is never rewritten, such as `catalog:` or a local path.
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
 * Splits at the last `@`, unless it's the start of a scope.
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
 * Existing specifiers are kept, except to switch to an `npm:` alias of the same major version.
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
 * Unlike {@link resolveSpecifier}, neither side is preferred.
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

function getAlias(specifier: string, dependency: string | undefined) {
  const alias = parseNpmAlias(specifier);
  // An alias to the dependency itself is a plain range
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
 * Looks through catalog references and npm aliases.
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
