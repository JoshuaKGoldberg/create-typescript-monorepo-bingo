import { type Creation, mergeCreations, type ProductionMode } from 'bingo';
import type { CreatedDirectory, IntakeDirectory } from 'bingo-fs';
import { type BlockCreation, producePreset } from 'bingo-stratum';
import semver from 'semver';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

import { rootBase } from '../bases/rootBase.ts';
import {
  defaults,
  type PackageOptions,
  type PackageSpec,
  type RootOptions,
  rootOptionsShape,
} from '../options.ts';
import {
  findSharedDependencies,
  findWorkspacePackages,
  type PackageManifest,
} from '../prepare/prepareRoot.ts';
import { packageBlocks, packagePreset, rootPreset } from '../presets.ts';
import { getDirectory, readJson, readText } from '../utils/files.ts';
import { getLibraryPackages, getPackageParents, sortByDependencies } from '../utils/options.ts';
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
export function produceMonorepo(settings: ProduceMonorepoSettings): Partial<Creation> {
  const options = normalizeOptions(settings.options);

  // CTM sets up Oxfmt or Prettier, but only formats with an existing Biome setup.
  if (settings.mode === 'setup' && options.formatter === 'biome') {
    throw new Error(
      "--formatter biome is for repositories that already format with Biome: new ones use 'oxfmt', 'prettier' or 'none'.",
    );
  }

  // Shared dependencies are found in the manifests CTM is about to write, through a draft
  // production: a new repository has none on disk, and a transition may add some, such as
  // a new build package's.
  if (options.catalogs === 'default') {
    const prepared = options.catalogShared ?? [];
    const draft = produceMonorepoOnce({
      ...settings,
      options: { ...options, catalogShared: prepared },
    });
    const draftFiles = toIntake(draft.files ?? {});
    const manifests = findWorkspacePackages(
      draftFiles,
      getPackageParents(options).map((parent) => `${parent}/*`),
    ).map((pkg) => ({ kind: 'library' as const, manifest: pkg.manifest }));
    const root = readJson(draftFiles, 'package.json');
    const workspace = parseYaml(readText(draftFiles, 'pnpm-workspace.yaml') ?? '{}') as
      | undefined
      | { catalog?: Record<string, string>; catalogs?: { default?: Record<string, string> } };

    const shared = findSharedDependencies(
      [
        ...(root ? [{ kind: 'root' as const, manifest: root as PackageManifest }] : []),
        ...manifests,
      ],
      { ...workspace?.catalog, ...workspace?.catalogs?.default },
    );

    return produceMonorepoOnce({
      ...settings,
      options: { ...options, catalogShared: [...new Set([...prepared, ...shared])].sort() },
    });
  }

  return produceMonorepoOnce({ ...settings, options });
}

function produceMonorepoOnce({
  files,
  mode,
  offline,
  options,
}: ProduceMonorepoSettings): Partial<Creation> {
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

  const rootProduction = producePreset(
    rootBase.createPreset({
      about: rootPreset.about,
      blocks: [...rootPreset.blocks, ...carriers],
    }),
    { files, mode, offline, options: { ...options, preset: 'root' } as RootOptions },
  );

  const creation = perPackage.reduce(
    (all, { creation: packageCreation, pkg }) =>
      mergeCreations(all, { files: nestFiles(pkg.directory, packageCreation.files) }),
    withoutExtensions(rootProduction) as Creation,
  );

  return {
    ...creation,
    scripts: [...creation.scripts, ...createFormatScripts(options, creation, files)],
    suggestions: [
      ...creation.suggestions,
      ...(readText(files, '.github/workflows/actions.lock') !== undefined &&
      listFiles(creation.files).some(
        (file) =>
          (file.startsWith('.github/workflows/') || file.startsWith('.github/actions/')) &&
          readText(files, file) !== readCreated(creation.files, file),
      )
        ? ['Workflows changed, so run `gh actions-lock` to update .github/workflows/actions.lock.']
        : []),
    ],
  };
}

/**
 * Fills in options that can't be prepared before prompting, such as the first package
 * of a new repository (named after it), and any `--new-package` to add.
 */
export function normalizeOptions(options: RootOptions): RootOptions {
  // bingo's CLI passes some invalid values through, such as unknown enum strings.
  const validated = z.looseObject(rootOptionsShape).safeParse(options);
  if (!validated.success) {
    throw new Error(
      `Invalid options: ${validated.error.issues
        .map((issue) => `--${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
    );
  }

  if (
    options.pnpm !== undefined &&
    !(semver.valid(options.pnpm) && semver.gte(options.pnpm, '12.0.0'))
  ) {
    throw new Error(
      `--pnpm must be a full version of pnpm 12 or newer, like ${defaults.pnpm}, not '${options.pnpm}'.`,
    );
  }

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
    const collision =
      created.directory === 'packages/build'
        ? { name: 'the build package' }
        : ['node_modules', 'dist', 'lib', 'coverage'].includes(
              created.directory.split('/').pop() ?? '',
            )
          ? { name: 'a reserved directory name' }
          : packages.find((pkg) => pkg.directory === created.directory);
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
    // A new package needs it.
    ...(options.newPackage && { buildPackageSkipped: false }),
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

function toIntake(directory: CreatedDirectory): IntakeDirectory {
  return Object.fromEntries(
    Object.entries(directory).flatMap(([name, entry]) => {
      if (entry === undefined || entry === false) {
        return [];
      }

      if (typeof entry === 'string') {
        return [[name, [entry]]];
      }

      return [[name, Array.isArray(entry) ? entry : toIntake(entry)]];
    }),
  );
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

/**
 * Formats the files CTM wrote, and only those, with the repository's formatter.
 */
function createFormatScripts(
  options: RootOptions,
  creation: Partial<Creation>,
  existing: IntakeDirectory | undefined,
) {
  if (options.formatter === 'none') {
    return [];
  }

  // Files CTM wrote back unchanged are the repository's, and keep their formatting.
  const files = listFiles(creation.files ?? {}).filter(
    (file) => readText(existing, file) !== readCreated(creation.files, file),
  );
  if (!files.length) {
    return [];
  }

  const formatter =
    options.formatter === 'prettier'
      ? 'prettier --ignore-unknown --write'
      : options.formatter === 'biome'
        ? 'biome check --write --no-errors-on-unmatched --files-ignore-unknown=true'
        : 'oxfmt --no-error-on-unmatched-pattern';
  // bingo runs commands without a shell, so paths are passed as plain arguments.
  const paths = files.filter((file) => !/\s/.test(file)).join(' ');

  return [{ commands: [`pnpm exec ${formatter} ${paths}`], phase: 1 }];
}

function listFiles(directory: CreatedDirectory, prefix = ''): string[] {
  return Object.entries(directory).flatMap(([name, entry]) => {
    if (!entry) {
      return [];
    }

    return typeof entry === 'string' || Array.isArray(entry)
      ? [`${prefix}${name}`]
      : listFiles(entry, `${prefix}${name}/`);
  });
}

function readCreated(directory: CreatedDirectory | undefined, filePath: string) {
  let current: unknown = directory;
  for (const segment of filePath.split('/')) {
    current = (current as Record<string, unknown> | undefined)?.[segment];
  }
  return Array.isArray(current) ? (current[0] as string) : (current as string | undefined);
}
