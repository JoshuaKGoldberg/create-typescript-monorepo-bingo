import type { CreatedBlockExtension } from 'bingo-stratum';

import type { PackageOptions, RootOptions } from '../options.ts';

/**
 * Lets a package Block send an extension to a root Block.
 * Package options are a superset of root options, but Stratum's types don't allow
 * extensions across Bases even then, so this casts (report §6, workaround 2).
 */
export function asPackageExtension<Props extends object>(
  extension: CreatedBlockExtension<Props, RootOptions>,
): CreatedBlockExtension<object, PackageOptions> {
  return extension as unknown as CreatedBlockExtension<object, PackageOptions>;
}

/**
 * Converts an extension that escaped a package production back into a root extension.
 */
export function asRootExtension(
  extension: CreatedBlockExtension<object, PackageOptions>,
): CreatedBlockExtension<object, RootOptions> {
  return extension as unknown as CreatedBlockExtension<object, RootOptions>;
}
