import path from 'node:path';

import type { TemplatePrepareContext } from 'bingo';
import type { CreatedDirectory, IntakeDirectory } from 'bingo-fs';
import { parse as parseYaml } from 'yaml';

import type { CatalogMode, PackageKind, PackageSpec, RootOptions, TaskRunner } from '../options.ts';
import { type DependencyField, dependencyFields } from '../utils/catalogs.ts';
import { getDirectory, getEntry, isOwnedFile, readJson, readText } from '../utils/files.ts';
import { pin, tryPin } from '../utils/pins.ts';
import { isProtocolSpecifier, parseNpmAlias, resolveSpecifier } from '../utils/versions.ts';

export interface PackageManifest {
  author?: string | { email?: string; name?: string };
  bin?: unknown;
  contributors?: (string | { email?: string; name?: string })[];
  description?: string;
  devDependencies?: Record<string, string>;
  engines?: { node?: string };
  exports?: unknown;
  homepage?: string;
  main?: unknown;
  name?: string;
  packageManager?: string;
  private?: boolean;
  repository?: string | { url?: string };
  scripts?: Record<string, string>;
  types?: unknown;
}

export interface WorkspacePackage {
  directory: string;
  files: IntakeDirectory;
  manifest: PackageManifest;
}

/**
 * Infers root options from an existing repository's files.
 * Every value is optional: in setup mode there are no files, and produce() fills defaults.
 */
export function prepareRoot(
  context: TemplatePrepareContext<Partial<RootOptions>, unknown>,
): Partial<RootOptions> {
  const files = context.files as IntakeDirectory | undefined;
  if (!files || !Object.keys(files).length) {
    return { catalogs: 'default' };
  }

  const rootManifest = readJson(files, 'package.json') as PackageManifest | undefined;
  assertMonorepoRoot(rootManifest);
  const workspace = readWorkspaceYaml(files);
  const workspacePackages = findWorkspacePackages(files, workspace?.packages ?? ['packages/*']);
  const repository = parseRepository(rootManifest?.repository);
  const author = getFirstPerson(rootManifest);
  const scopes = workspacePackages
    .map((pkg) => pkg.manifest.name)
    .filter((name) => name?.startsWith('@'))
    .map((name) => name?.split('/')[0]);
  const scope =
    workspacePackages
      .map((pkg) => pkg.manifest.name)
      .find((name) => name?.startsWith('@') && name.endsWith('/build'))
      ?.replace(/\/build$/, '') ?? mostCommon(scopes);

  const catalogs = context.options.catalogs ?? inferCatalogMode(workspace);
  const packages = workspacePackages.map((pkg) => createPackageSpec(pkg, workspacePackages));
  const manifests = [
    ...(rootManifest ? [{ kind: 'root' as const, manifest: rootManifest }] : []),
    ...workspacePackages.map((pkg, index) => ({
      kind: packages[index]?.kind,
      manifest: pkg.manifest,
    })),
  ].filter(({ kind }) => kind !== 'site' && kind !== 'repo-owned' && kind !== 'bin-js');

  return {
    ...(author?.name && { author: author.name }),
    ...(author?.email && { email: author.email }),
    catalogs,
    ...(catalogs === 'default' && {
      catalogShared: findSharedDependencies(manifests, {
        ...workspace?.catalog,
        ...workspace?.catalogs?.default,
      }),
    }),
    ...(catalogs === 'named' && {
      catalogExcluded: findNamedConflicts(manifests, workspace?.catalogs),
    }),
    ...inferDescription(files, rootManifest),
    ...(readText(files, '.nvmrc') && { node: readText(files, '.nvmrc')?.trim() }),
    ...(rootManifest?.engines?.node && { nodeEngines: rootManifest.engines.node }),
    ...(repository && repository),
    packages,
    ...(rootManifest?.packageManager?.startsWith('pnpm@') && {
      pnpm: rootManifest.packageManager.slice('pnpm@'.length).split('+')[0],
    }),
    ...inferReleaseApp(files),
    ...(scope && { scope }),
    taskRunner: inferTaskRunner(files, workspace, rootManifest),
    ...(buildsLibrariesRecursively(rootManifest?.scripts?.build, packages) && {
      recursiveBuild: true,
    }),
    ...(workspacePackages.some(extendsRootTSConfig) && { rootTSConfigExtended: true }),
    ...inferTitle(files),
    ...inferTypeScript7Alias(rootManifest, workspace),
    ...inferFormatter(files, rootManifest),
    ...inferVitestConfig(files),
    // Packages importing each other through exports like ./dist/index.mjs need a build
    // before their imports have types.
    ...(workspacePackages.some((pkg) =>
      /(?:^|["/])(?:dist|lib|build|out)\//.test(
        JSON.stringify([pkg.manifest.exports, pkg.manifest.main, pkg.manifest.types]),
      ),
    ) &&
      rootManifest?.scripts?.build !== undefined && { packagesExportBuildOutput: true }),
    ...(inferVitestConfig(files).vitestConfig === undefined &&
      readText(files, 'vitest.config.ts') === undefined &&
      workspacePackages.some(runsVitestWithoutConfig) && { packagesRunVitest: true }),
    ...inferTestRunner(files, rootManifest, workspacePackages),
    ...inferWorkflowExtension(files),
  };
}

interface WorkspaceYaml {
  catalog?: Record<string, string>;
  catalogs?: Partial<Record<string, Record<string, string>>>;
  packages?: string[];
  tasks?: unknown;
}

function readWorkspaceYaml(files: IntakeDirectory): undefined | WorkspaceYaml {
  const text = readText(files, 'pnpm-workspace.yaml');
  if (!text) {
    return undefined;
  }

  try {
    return parseYaml(text) as undefined | WorkspaceYaml;
  } catch {
    return undefined;
  }
}

/**
 * Finds workspace packages by matching `packages/*`-style globs against the in-memory files.
 * Only single-level `&lt;directory>/*` globs and exact directories are supported.
 */
export function findWorkspacePackages(
  files: IntakeDirectory | CreatedDirectory,
  globs: string[],
): WorkspacePackage[] {
  const found: WorkspacePackage[] = [];
  // Hand-written lists may hold empty items, which pnpm ignores.
  globs = globs.filter((glob): glob is string => typeof glob === 'string');
  const excluded = new Set(
    globs
      .filter((glob) => glob.startsWith('!'))
      .map((glob) => glob.slice(1).replace(/^\.\//, '').replace(/\/$/, '')),
  );

  for (const glob of globs) {
    if (glob.startsWith('!')) {
      continue;
    }

    const normalized = glob.replace(/^\.\//, '').replace(/\/$/, '');
    const candidates = normalized.endsWith('/*')
      ? Object.keys(getDirectory(files as IntakeDirectory, normalized.slice(0, -2)) ?? {})
          .sort()
          .map((name) => `${normalized.slice(0, -2)}/${name}`)
      : [normalized];

    for (const directory of candidates) {
      const packageFiles = getDirectory(files as IntakeDirectory, directory);
      const manifest = readJson(packageFiles, 'package.json') as PackageManifest | undefined;
      // Overlapping globs, like packages/* and packages/a, find a package once.
      if (
        packageFiles &&
        manifest &&
        !isExcluded(directory, excluded) &&
        !found.some((pkg) => pkg.directory === directory)
      ) {
        found.push({ directory, files: packageFiles, manifest });
      }
    }
  }

  return found;
}

function isExcluded(directory: string, excluded: Set<string>) {
  return [...excluded].some((pattern) =>
    pattern.endsWith('/*')
      ? directory.startsWith(pattern.slice(0, -1)) &&
        !directory.slice(pattern.length - 1).includes('/')
      : directory === pattern,
  );
}

/**
 * Infers what kind of package a workspace directory holds.
 */
export function inferPackageKind({ directory, files, manifest }: WorkspacePackage): PackageKind {
  if (manifest.name?.endsWith('/build') && directory.endsWith('/build')) {
    return 'build';
  }

  const dependencies = getAllDependencies(manifest);
  if (
    'astro' in dependencies ||
    getEntry(files, 'astro.config.ts') ||
    getEntry(files, 'astro.config.mjs')
  ) {
    return 'site';
  }

  if (getEntry(files, 'tsdown.config.ts')) {
    return 'library';
  }

  if (manifest.bin && !getEntry(files, 'tsconfig.json')) {
    return 'bin-js';
  }

  return 'repo-owned';
}

function createPackageSpec(pkg: WorkspacePackage, all: WorkspacePackage[]): PackageSpec {
  const tsconfig = readJson(pkg.files, 'tsconfig.json') as
    | undefined
    | {
        compilerOptions?: { isolatedDeclarations?: boolean };
        extends?: unknown;
        files?: unknown;
        include?: unknown;
      };
  const dependencies = getAllDependencies(pkg.manifest);
  const workspaceNames = new Set(all.map((other) => other.manifest.name));
  const workspaceDependencies = Object.entries(dependencies)
    .filter(([name, specifier]) => workspaceNames.has(name) && specifier.startsWith('workspace:'))
    .map(([name]) => name);

  return {
    ...(pkg.manifest.description && { description: pkg.manifest.description }),
    directory: pkg.directory,
    ...(pkg.manifest.homepage && { homepage: pkg.manifest.homepage }),
    ...(tsconfig?.compilerOptions?.isolatedDeclarations && { isolatedDeclarations: true }),
    // tsdown's workspace mode skips package configs without an entry of their own.
    ...(!isTsdownWorkspaceReady(readText(pkg.files, 'tsdown.config.ts')) && {
      tsdownWorkspaceReady: false,
    }),
    kind: inferPackageKind(pkg),
    ...(extendsBuildTSConfig(tsconfig) && { extendsBuildTSConfig: true }),
    ...((extendsBuildTSConfig(tsconfig) ||
      /['"][^'"]*\/build(?:\/tsdown)?['"]/.test(readText(pkg.files, 'tsdown.config.ts') ?? '')) && {
      usesBuildPackage: true,
    }),
    name: pkg.manifest.name ?? pkg.directory.split('/').pop() ?? pkg.directory,
    ...getNxTargets(pkg),
    ...(pkg.manifest.scripts && { scripts: Object.keys(pkg.manifest.scripts) }),
    ...getToolDevDependencies(pkg.manifest),
    ...(workspaceDependencies.length && { workspaceDependencies }),
  };
}

/**
 * Whether a package's tsconfig extends the root tsconfig.json, which it then shares
 * settings with, like include and noEmit.
 */
function extendsRootTSConfig(pkg: WorkspacePackage) {
  const tsconfig = readJson(pkg.files, 'tsconfig.json') as undefined | { extends?: unknown };
  return [tsconfig?.extends]
    .flat()
    .some(
      (base) =>
        typeof base === 'string' &&
        path.posix.normalize(path.posix.join(pkg.directory, base)).replace(/\.json$/, '') ===
          'tsconfig',
    );
}

/**
 * Whether a package's tsconfig extends the build package's shared base, as CTM's do.
 * Other tsconfigs are the repository's own, which CTM leaves alone.
 */
function extendsBuildTSConfig(tsconfig: undefined | { extends?: unknown }) {
  return [tsconfig?.extends]
    .flat()
    .some((base) => typeof base === 'string' && base.includes('/build/tsconfig'));
}

function getAllDependencies(manifest: PackageManifest): Record<string, string> {
  const record = manifest as Partial<Record<DependencyField, Record<string, string>>>;
  return Object.assign({}, ...dependencyFields.map((field) => record[field] ?? {})) as Record<
    string,
    string
  >;
}

function inferCatalogMode(workspace: undefined | WorkspaceYaml): CatalogMode {
  // Named mode is CTM's dev/prod/peer catalogs; other named catalogs are the repository's.
  if (
    Object.keys(workspace?.catalogs ?? {}).some((name) => ['dev', 'peer', 'prod'].includes(name))
  ) {
    return 'named';
  }

  return Object.keys({ ...workspace?.catalog, ...workspace?.catalogs?.default }).length
    ? 'default'
    : 'none';
}

interface ManifestWithKind {
  kind: 'root' | PackageKind | undefined;
  manifest: PackageManifest;
}

const isLiteral = (specifier: string) => !isProtocolSpecifier(specifier);

/**
 * Gets what a catalog entry on disk will be after CTM applies its pins.
 */
function getWrittenCatalogEntry(dependency: string, specifier: string) {
  const pinned = tryPin(dependency);
  return pinned ? resolveSpecifier(specifier, pinned, dependency) : specifier;
}

/**
 * In default catalog mode, finds dependencies that two or more manifests declare,
 * always with the same specifier, which must also match any existing catalog entry.
 */
export function findSharedDependencies(
  manifests: ManifestWithKind[],
  catalog: Record<string, string> = {},
): string[] {
  const declarations = new Map<string, Set<string>>();
  const counts = new Map<string, number>();

  for (const { kind, manifest } of manifests) {
    for (const [dependency, specifier] of Object.entries(getAllDependencies(manifest))) {
      if (specifier === 'catalog:' || specifier === 'catalog:default') {
        counts.set(dependency, (counts.get(dependency) ?? 0) + 2);
        continue;
      }

      if (!isLiteral(specifier)) {
        continue;
      }

      const written = getWrittenSpecifier(kind, 'devDependencies', dependency, specifier);
      declarations.set(dependency, (declarations.get(dependency) ?? new Set()).add(written));
      counts.set(dependency, (counts.get(dependency) ?? 0) + 1);
    }
  }

  // A literal that differs from the catalog entry is a conflict, not a shared dependency.
  for (const [dependency, specifier] of Object.entries(catalog)) {
    const literals = declarations.get(dependency);
    literals?.add(getWrittenCatalogEntry(dependency, specifier));
  }

  return [...counts]
    .filter(([dependency, count]) => count >= 2 && (declarations.get(dependency)?.size ?? 0) <= 1)
    .map(([dependency]) => dependency)
    .sort();
}

const namedCatalogs: Partial<Record<DependencyField, string>> = {
  dependencies: 'prod',
  devDependencies: 'dev',
  peerDependencies: 'peer',
};

/**
 * In named catalog mode, finds `&lt;catalog>:&lt;dependency>` pairs that manifests declare
 * with different specifiers. Those stay uncataloged rather than being forced to one version.
 */
export function findNamedConflicts(
  manifests: ManifestWithKind[],
  catalogs: Partial<Record<string, Record<string, string>>> = {},
): string[] {
  const specifiers = new Map<string, Set<string>>();

  for (const { kind, manifest } of manifests) {
    const record = manifest as Partial<Record<DependencyField, Record<string, string>>>;
    for (const field of dependencyFields) {
      // The build package's runtime dependencies are development tools.
      const catalog = kind === 'build' ? 'dev' : namedCatalogs[field];
      if (!catalog) {
        continue;
      }

      for (const [dependency, diskSpecifier] of Object.entries(record[field] ?? {})) {
        if (!isLiteral(diskSpecifier)) {
          continue;
        }

        // Compare what CTM will write, so a version it's about to change doesn't count.
        const specifier = getWrittenSpecifier(kind, field, dependency, diskSpecifier);
        const key = `${catalog}:${dependency}`;
        specifiers.set(key, (specifiers.get(key) ?? new Set()).add(specifier));
      }
    }
  }

  // A literal that differs from the existing catalog entry is a conflict too.
  for (const [catalog, entries] of Object.entries(catalogs)) {
    for (const [dependency, specifier] of Object.entries(entries ?? {})) {
      specifiers
        .get(`${catalog}:${dependency}`)
        ?.add(getWrittenCatalogEntry(dependency, specifier));
    }
  }

  return [...specifiers]
    .filter(([, values]) => values.size > 1)
    .map(([key]) => key)
    .sort();
}

/**
 * Approximates the specifier CTM's blocks write for a dependency that's on disk,
 * for the dependencies those blocks manage with pinned versions.
 */
function getWrittenSpecifier(
  kind: ManifestWithKind['kind'],
  field: DependencyField,
  dependency: string,
  diskSpecifier: string,
): string {
  if (kind === 'build' && field === 'dependencies') {
    const ours =
      dependency === 'tsdown'
        ? pin('tsdown')
        : dependency === 'typescript'
          ? pin('typescript')
          : undefined;
    return ours ? resolveSpecifier(diskSpecifier, ours, dependency) : diskSpecifier;
  }

  const pinned = kind === 'root' && field === 'devDependencies' ? tryPin(dependency) : undefined;
  return pinned ? resolveSpecifier(diskSpecifier, pinned, dependency) : diskSpecifier;
}

function getFirstPerson(manifest: PackageManifest | undefined) {
  // Contributors aren't authors: without an author, packages fall back to the owner.
  const person = manifest?.author;
  if (!person) {
    return undefined;
  }

  if (typeof person === 'string') {
    // "Name <email> (url)", parsed without backtracking-prone patterns.
    const name = person.split(/[<(]/)[0]?.trim();
    const email = /<([^>]+)>/.exec(person)?.[1];
    return name ? { email, name } : undefined;
  }

  return person;
}

function parseRepository(repository: PackageManifest['repository']) {
  const url = typeof repository === 'string' ? repository : repository?.url;
  // Full URLs, and npm's "owner/repo" and "github:owner/repo" shorthands.
  const match =
    url &&
    (/github\.com[/:]([^/]+)\/([^/#]+?)(?:\.git)?(?:[/#]|$)/.exec(url) ??
      /^(?:github:)?([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(url));
  return match?.[1] && match[2] ? { owner: match[1], repository: match[2] } : undefined;
}

function inferReleaseApp(files: IntakeDirectory): Partial<RootOptions> {
  const workflows = getDirectory(files, '.github/workflows');
  const release = readText(workflows, 'release.yml') ?? readText(workflows, 'release.yaml');
  const match = release && /vars\.([A-Z0-9_]+)_CLIENT_ID/.exec(release);
  return match?.[1] ? { releaseApp: match[1] } : {};
}

function inferTaskRunner(
  files: IntakeDirectory,
  workspace: undefined | WorkspaceYaml,
  manifest: PackageManifest | undefined,
): TaskRunner {
  if (getEntry(files, 'turbo.json')) {
    return 'turbo';
  }

  if (getEntry(files, 'nx.json')) {
    return 'nx';
  }

  // A root that tests by running each package's script is using pnpm as its task runner.
  // A recursive build alone isn't: CTM writes one for packages tsdown's workspace mode skips.
  return workspace?.tasks || recursivePnpm.test(manifest?.scripts?.test ?? '') ? 'pnpm' : 'none';
}

const recursivePnpm = /\bpnpm\b[^&|;]*\s(?:-r|--recursive|-F|--filter)\b/;

/**
 * Whether a root build script runs library packages' own build scripts, with pnpm
 * recursively or filtered to them, rather than, say, only a docs site's.
 */
function buildsLibrariesRecursively(script: string | undefined, packages: PackageSpec[]) {
  const libraries = packages.filter((pkg) => pkg.kind === 'library');

  // Each command counts on its own, as in `pnpm --filter ./docs build && pnpm -r build`.
  return (script ?? '').split(/&&|\|\||;/).some((command) => {
    if (!recursivePnpm.test(command)) {
      return false;
    }

    const filters = [...command.matchAll(/(?:-F|--filter(?:-prod)?)(?:=|\s+)["']?([^\s"']+)/g)].map(
      ([, filter = '']) => filter,
    );

    return (
      !filters.length ||
      filters.some((filter) => {
        // Negations, and a package's dependencies (`docs...`, `docs^...`), can be libraries.
        if (filter.startsWith('!') || filter.endsWith('...')) {
          return true;
        }

        // Path filters, like ./packages/*, are relative to the root; others match names.
        const isPath = filter.startsWith('.') || filter.startsWith('{');
        const pattern = new RegExp(
          `^${filter
            .replace(/^\{(.*)\}$/, '$1')
            .replace(/^\.\.\./, '')
            .replace(/^\.\//, '')
            .replace(/\/$/, '')
            .replaceAll(/[.+?^${}()|[\]\\]/g, '\\$&')
            .replaceAll('*', '.*')}$`,
        );
        return libraries.some((pkg) => pattern.test(isPath ? pkg.directory : pkg.name));
      })
    );
  });
}

function inferTitle(files: IntakeDirectory): Partial<RootOptions> {
  const readme = readText(files, 'README.md');
  const match = readme && (/<h1[^>]*>([^<]+)<\/h1>/.exec(readme) ?? /^# (.+)$/m.exec(readme));
  return match?.[1] ? { title: match[1].trim() } : {};
}

function inferTypeScript7Alias(
  manifest: PackageManifest | undefined,
  workspace: undefined | WorkspaceYaml,
): Partial<RootOptions> {
  for (const [name, declared] of Object.entries(manifest?.devDependencies ?? {})) {
    // Look through catalog references, as flint's catalog:dev alias needs.
    const specifier = declared.startsWith('catalog:')
      ? ((declared === 'catalog:'
          ? (workspace?.catalog?.[name] ?? workspace?.catalogs?.default?.[name])
          : workspace?.catalogs?.[declared.slice('catalog:'.length)]?.[name]) ?? declared)
      : declared;
    const alias = parseNpmAlias(specifier);
    if (
      name !== 'typescript' &&
      alias?.name === 'typescript' &&
      /^[~^]?7/.test(alias.range ?? '')
    ) {
      return { typescript7Alias: name };
    }
  }

  return {};
}

function inferWorkflowExtension(files: IntakeDirectory): Partial<RootOptions> {
  const workflows = getDirectory(files, '.github/workflows');
  if (!workflows) {
    return {};
  }

  // Only the workflows CTM writes count: a hand-added deploy.yml shouldn't make CTM
  // write a second copy of every workflow.
  for (const name of ['ci', 'release', 'octoguide', 'contributors']) {
    for (const workflowExtension of ['yaml', 'yml'] as const) {
      if (getEntry(workflows, `${name}.${workflowExtension}`)) {
        return { workflowExtension };
      }
    }
  }

  return {};
}

/**
 * Refuses repositories whose root package.json is itself a published package: CTM manages
 * monorepos whose root is private, with packages in workspace directories.
 */
function assertMonorepoRoot(manifest: PackageManifest | undefined) {
  const root = manifest as (PackageManifest & Record<string, unknown>) | undefined;
  if (root && !root.private && (root.main || root.exports || root.bin || root.module)) {
    throw new Error(
      `The root package.json is a published package${root.name ? ` (${root.name})` : ''}. create-typescript-monorepo-bingo manages monorepos with a private root and packages in workspace directories. If the root isn't published, add "private": true to it; for a single-package repository, see create-typescript-app.`,
    );
  }
}

function getNxTargets(pkg: WorkspacePackage): Partial<PackageSpec> {
  const project = readJson(pkg.files, 'project.json') as undefined | { targets?: unknown };
  const targets =
    project?.targets && typeof project.targets === 'object' ? Object.keys(project.targets) : [];
  return targets.length ? { nxTargets: targets.sort() } : {};
}

function getToolDevDependencies(manifest: PackageManifest): Partial<PackageSpec> {
  const tools = Object.fromEntries(
    Object.entries(manifest.devDependencies ?? {}).filter(([name]) =>
      ['tsdown', 'vitest'].includes(name),
    ),
  );
  return Object.keys(tools).length ? { toolDevDependencies: tools } : {};
}

function mostCommon(values: (string | undefined)[]) {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (value) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
}

const prettierConfigs = [
  '.prettierrc',
  '.prettierrc.cjs',
  '.prettierrc.js',
  '.prettierrc.json',
  '.prettierrc.json5',
  '.prettierrc.mjs',
  '.prettierrc.toml',
  '.prettierrc.yaml',
  '.prettierrc.yml',
  'prettier.config.cjs',
  'prettier.config.js',
  'prettier.config.mjs',
  'prettier.config.ts',
];

/**
 * Infers the formatter: a repository that uses Prettier and not Oxfmt keeps Prettier.
 */
function inferFormatter(
  files: IntakeDirectory,
  manifest: PackageManifest | undefined,
): Partial<RootOptions> {
  const record = manifest as (PackageManifest & Record<string, unknown>) | undefined;
  const dependencies = { ...(record?.dependencies as object), ...manifest?.devDependencies };
  const usesOxfmt = 'oxfmt' in dependencies || !!getEntry(files, 'oxfmt.config.ts');
  const usesPrettier =
    'prettier' in dependencies ||
    !!record?.prettier ||
    prettierConfigs.some((name) => getEntry(files, name));

  // Biome formats and sorts imports itself, so CTM formats its files with Biome instead,
  // unless Biome only lints, as alongside Prettier.
  const biomeConfig = readText(files, 'biome.json') ?? readText(files, 'biome.jsonc');
  const formatsWithBiome =
    ('@biomejs/biome' in dependencies || biomeConfig !== undefined) &&
    !/"formatter"\s*:\s*\{[^}]*"enabled"\s*:\s*false/.test(biomeConfig ?? '');

  return usesOxfmt
    ? {}
    : usesPrettier
      ? { formatter: 'prettier' }
      : formatsWithBiome
        ? { formatter: 'biome' }
        : {};
}

/**
 * Infers the root Vitest config's file name, when it isn't vitest.config.ts.
 */

/**
 * Whether a package runs Vitest itself, through a script or an nx project.json target,
 * without a config of its own: Vitest would then find and use a root config instead.
 */
function runsVitestWithoutConfig(pkg: WorkspacePackage) {
  const runs =
    /\bvitest\b/.test(pkg.manifest.scripts?.test ?? '') ||
    /\bvitest\b/.test(readText(pkg.files, 'project.json') ?? '');
  const hasConfig = ['vitest', 'vite'].some((tool) =>
    ['ts', 'mts', 'cts', 'js', 'mjs', 'cjs'].some((extension) =>
      getEntry(pkg.files, `${tool}.config.${extension}`),
    ),
  );
  return runs && !hasConfig;
}

function inferVitestConfig(files: IntakeDirectory): Partial<RootOptions> {
  const name = [
    'vitest.config.mts',
    'vitest.config.js',
    'vitest.config.mjs',
    'vite.config.ts',
    'vite.config.mts',
    'vite.config.js',
    'vite.config.mjs',
  ].find((candidate) => getEntry(files, candidate));
  const existing = readText(files, 'vitest.config.ts');
  return {
    ...(name && { vitestConfig: name }),
    // A repository's own config may not define the per-package projects CTM's does.
    ...((name !== undefined || (existing !== undefined && !isOwnedFile(existing))) && {
      vitestConfigUnowned: true,
    }),
  };
}

/**
 * Infers the description from the root package.json, or else the README's tagline, so
 * transitions (including the weekly workflow's) never need to prompt for it.
 */
function inferDescription(
  files: IntakeDirectory,
  manifest: PackageManifest | undefined,
): Partial<RootOptions> {
  if (manifest?.description) {
    return { description: manifest.description };
  }

  // The README's centered tagline, or its first plain paragraph line, skipping code blocks,
  // HTML comments, headings, lists, quotes, tables and badges.
  const readme = (readText(files, 'README.md') ?? '')
    .replaceAll(/```[\s\S]*?```/g, '')
    .replaceAll(/<!--[\s\S]*?-->/g, '');
  const tagline =
    /<p align="center">([^<]+)<\/p>/.exec(readme)?.[1] ??
    readme
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line && !/^(?:[#<>[|`*+-]|\d+\.)/.test(line));

  return tagline ? { description: tagline.trim() } : {};
}

function isTsdownWorkspaceReady(config: string | undefined) {
  const code = config?.replaceAll(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  return code === undefined || /\bentry\s*:|\.\.\.\s*base\b/.test(code);
}

/**
 * Infers whether a repository tests with Vitest. A task runner's test script, like
 * `turbo run test`, defers to the packages' own scripts and dependencies.
 */
function inferTestRunner(
  files: IntakeDirectory,
  manifest: PackageManifest | undefined,
  packages: WorkspacePackage[],
): Partial<RootOptions> {
  const mentionsVitest = (candidate: PackageManifest | undefined) => {
    // Scripts are indexed by name, so a test script may not exist.
    const script: string | undefined = candidate?.scripts?.test;
    return (
      !!candidate && ('vitest' in getAllDependencies(candidate) || !!script?.includes('vitest'))
    );
  };

  const test: string | undefined = manifest?.scripts?.test;
  if (mentionsVitest(manifest)) {
    return {};
  }

  // A root test script of its own, like node --test, is another test runner.
  const delegates = /\b(?:turbo|nx|lerna)\b/.test(test ?? '') || recursivePnpm.test(test ?? '');
  if (test !== undefined && !delegates) {
    return { testRunner: 'other' };
  }

  if (
    packages.some((pkg) => mentionsVitest(pkg.manifest)) ||
    getEntry(files, 'vitest.config.ts') ||
    inferVitestConfig(files).vitestConfig
  ) {
    return {};
  }

  // Packages testing with something else, or a repository CTM already manages without
  // Vitest anywhere, as `--testRunner other` leaves it.
  // Only files that exist count: a missing one isn't a sign CTM manages the repository.
  const managed = ['eslint.config.ts', 'packages/build/src/tsdown/base.ts'].some((path) => {
    const text = readText(files, path);
    return text !== undefined && isOwnedFile(text);
  });
  return packages.some((pkg) => pkg.manifest.scripts?.test) || managed
    ? { testRunner: 'other' }
    : {};
}
