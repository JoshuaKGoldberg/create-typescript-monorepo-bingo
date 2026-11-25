import pinsPackage from '@ctm/pins/package.json' with { type: 'json' };

const pins: Partial<Record<string, string>> = pinsPackage.devDependencies;

/**
 * Versions come from the `@ctm/pins` package so that Renovate updates them.
 */
export function pin(name: string): string {
  const version = pins[name];
  if (version === undefined) {
    throw new Error(`No pinned version for '${name}'. Add it to packages/pins/package.json.`);
  }

  return version;
}

export function pinned(...names: string[]): Record<string, string> {
  return Object.fromEntries(names.map((name) => [name, pin(name)]));
}

export function tryPin(name: string): string | undefined {
  return pins[name];
}
