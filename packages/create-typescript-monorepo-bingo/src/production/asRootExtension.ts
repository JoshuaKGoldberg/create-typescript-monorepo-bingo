import type { CreatedBlockExtension } from 'bingo-stratum';

import type { PackageOptions, RootOptions } from '../options.ts';

/**
 * Stratum's types don't allow extensions across Bases, even when options are a superset.
 */
export function asPackageExtension<Props extends object>(
  extension: CreatedBlockExtension<Props, RootOptions>,
): CreatedBlockExtension<object, PackageOptions> {
  return extension as unknown as CreatedBlockExtension<object, PackageOptions>;
}

export function asRootExtension(
  extension: CreatedBlockExtension<object, PackageOptions>,
): CreatedBlockExtension<object, RootOptions> {
  return extension as unknown as CreatedBlockExtension<object, RootOptions>;
}
