import pinsPackage from '@ctm/pins/package.json' with { type: 'json' };

const pins: Partial<Record<string, string>> = pinsPackage.devDependencies;

/**
 * Gets the version CTM writes for a dependency.
 * Every version comes from `@ctm/pins`' manifest, so Renovate keeps them current.
 */
export function pin(name: string): string {
  const version = pins[name];
  if (version === undefined) {
    throw new Error(`No pinned version for '${name}': add it to packages/pins/package.json.`);
  }

  return version;
}

/**
 * Creates a dependencies object of pinned versions for the given names.
 */
export function pinned(...names: string[]): Record<string, string> {
  return Object.fromEntries(names.map((name) => [name, pin(name)]));
}

/**
 * Gets the version CTM writes for a dependency, if it pins one.
 */
export function tryPin(name: string): string | undefined {
  return pins[name];
}
