import { type Creation, mergeCreations, type ProductionMode } from 'bingo';
import type { CreatedDirectory, IntakeDirectory } from 'bingo-fs';
import { type BlockCreation, producePreset } from 'bingo-stratum';

import { rootBase } from '../bases/rootBase.ts';
import type { PackageOptions, PackageSpec, RootOptions } from '../options.ts';
import { packageBlocks, packagePreset, rootPreset } from '../presets.ts';
import { getDirectory } from '../utils/files.ts';
import { getLibraryPackages, sortByDependencies } from '../utils/options.ts';
import { asRootExtension } from './asRootExtension.ts';

export interface ProduceMonorepoSettings {
  files?: IntakeDirectory;
  mode?: ProductionMode;
  offline?: boolean;
  options: RootOptions;
}

/**
 * Produces a monorepo with N+1 Stratum productions: one per library package,
 * each nested under its directory, then one for the root.
 *
 * Extensions from package Blocks to root Blocks (catalog entries, tsconfig references)
 * escape their package production. Each is forwarded into the root production through
 * its own small "carrier" Block, because Stratum's refinement extensions are applied
 * with a shallow spread that would lose entries and replace intake values.
 */
export function produceMonorepo({
  files,
  mode,
  offline,
  options: rawOptions,
}: ProduceMonorepoSettings): Partial<Creation> {
  const options = normalizeOptions(rawOptions);
  const ownBlocks = new Set<unknown>(packageBlocks);

  const perPackage = sortByDependencies(getLibraryPackages(options)).map((pkg) => {
    const packageFiles = getDirectory(files, pkg.directory);
    const creation = producePreset(packagePreset, {
      files: packageFiles,
      // A package with no files yet is being added: it gets setup output even in transitions.
      mode: packageFiles ? mode : mode && 'setup',
      offline,
      options: { ...options, package: pkg, preset: 'package' } as PackageOptions,
    });

    return { creation, pkg };
  });

  const escaped = perPackage.flatMap(({ creation }) =>
    creation.extensions.filter((extension) => !ownBlocks.has(extension.block)),
  );

  const carriers = escaped.map((extension, index) =>
    rootBase.createBlock({
      about: { name: `Package Extension ${String(index)}` },
      produce: () => ({ extensions: [asRootExtension(extension)] }),
    }),
  );

  const root = producePreset(
    rootBase.createPreset({
      about: rootPreset.about,
      blocks: [...rootPreset.blocks, ...carriers],
    }),
    { files, mode, offline, options: { ...options, preset: 'root' } as RootOptions },
  );

  return withoutExtensions(
    perPackage.reduce(
      (all, { creation, pkg }) =>
        mergeCreations(all, { files: nestFiles(pkg.directory, creation.files) }),
      withoutExtensions(root) as Creation,
    ),
  );
}

/**
 * Fills in options that can't be prepared before prompting, such as the first package
 * of a new repository (named after it), and any `--new-package` to add.
 */
export function normalizeOptions(options: RootOptions): RootOptions {
  const packages: PackageSpec[] = [...(options.packages ?? [])];

  // prepare() always infers packages from an existing repository, so only a new one,
  // with no packages option at all, gets a first package named after it.
  if (options.packages === undefined && !options.newPackage) {
    packages.push(createNewPackage(options.repository, options.description));
  }

  if (options.newPackage && !packages.some((pkg) => pkg.name === options.newPackage)) {
    const created = createNewPackage(
      options.newPackage,
      options.newPackageDescription ?? `The ${options.newPackage} package in ${options.title}.`,
    );
    const collision = packages.find((pkg) => pkg.directory === created.directory);
    if (collision) {
      throw new Error(
        `Can't add --newPackage ${options.newPackage}: ${created.directory} already holds ${collision.name}.`,
      );
    }
    packages.push(created);
  }

  if (!packages.some((pkg) => pkg.kind === 'build')) {
    packages.push({
      description: `Shared build configs for ${options.title}`,
      directory: 'packages/build',
      kind: 'build',
      name: `${options.scope ?? `@${options.repository}`}/build`,
    });
  }

  return {
    ...options,
    // A new repository's default catalog holds what CTM itself adds to every manifest.
    ...(options.catalogs === 'default' &&
      options.catalogShared === undefined && { catalogShared: ['@types/node'] }),
    packages,
  };
}

const packageNamePattern = /^(?:@[a-z0-9][\w.~-]*\/)?[a-z0-9][\w.~-]*$/;

function createNewPackage(name: string, description: string | undefined): PackageSpec {
  if (!packageNamePattern.test(name) || name.length > 214 || /[A-Z]/.test(name)) {
    throw new Error(`'${name}' isn't a valid npm package name.`);
  }

  return {
    ...(description && { description }),
    directory: `packages/${name.replace(/^@[^/]+\//, '')}`,
    isolatedDeclarations: true,
    kind: 'library',
    name,
  };
}

function nestFiles(directory: string, files: CreatedDirectory | undefined): CreatedDirectory {
  let nested: CreatedDirectory = files ?? {};
  for (const segment of directory.split('/').reverse()) {
    nested = { [segment]: nested };
  }

  return nested;
}

function withoutExtensions<Options extends object>(
  creation: Partial<BlockCreation<Options>>,
): Partial<Creation> {
  const rest = { ...creation };
  delete rest.extensions;
  return rest;
}
