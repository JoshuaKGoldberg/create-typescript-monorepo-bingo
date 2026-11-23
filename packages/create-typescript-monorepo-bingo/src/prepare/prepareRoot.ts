import type { TemplatePrepareContext } from 'bingo';
import type { CreatedDirectory, IntakeDirectory } from 'bingo-fs';
import { parse as parseYaml } from 'yaml';

import type { CatalogMode, PackageKind, PackageSpec, RootOptions, TaskRunner } from '../options.ts';
import { type DependencyField, dependencyFields } from '../utils/catalogs.ts';
import { getDirectory, getEntry, readJson, readText } from '../utils/files.ts';
import { pin, tryPin } from '../utils/pins.ts';
import { isProtocolSpecifier, parseNpmAlias, resolveSpecifier } from '../utils/versions.ts';

export interface PackageManifest {
  author?: string | { email?: string; name?: string };
  bin?: unknown;
  contributors?: (string | { email?: string; name?: string })[];
  description?: string;
  devDependencies?: Record<string, string>;
  engines?: { node?: string };
  name?: string;
  packageManager?: string;
  private?: boolean;
  repository?: string | { url?: string };
  scripts?: Record<string, string>;
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
    taskRunner: inferTaskRunner(files, workspace),
    ...inferTitle(files),
    ...inferTypeScript7Alias(rootManifest, workspace),
    ...inferFormatter(files, rootManifest),
    ...inferVitestConfig(files),
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
      if (packageFiles && manifest && !isExcluded(directory, excluded)) {
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
    | { compilerOptions?: { isolatedDeclarations?: boolean } };
  const dependencies = getAllDependencies(pkg.manifest);
  const workspaceNames = new Set(all.map((other) => other.manifest.name));
  const workspaceDependencies = Object.entries(dependencies)
    .filter(([name, specifier]) => workspaceNames.has(name) && specifier.startsWith('workspace:'))
    .map(([name]) => name);

  return {
    ...(pkg.manifest.description && { description: pkg.manifest.description }),
    directory: pkg.directory,
    ...(tsconfig?.compilerOptions?.isolatedDeclarations && { isolatedDeclarations: true }),
    kind: inferPackageKind(pkg),
    name: pkg.manifest.name ?? pkg.directory.split('/').pop() ?? pkg.directory,
    ...(pkg.manifest.scripts && { scripts: Object.keys(pkg.manifest.scripts) }),
    ...(workspaceDependencies.length && { workspaceDependencies }),
  };
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
  const person = manifest?.author ?? manifest?.contributors?.[0];
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

function inferTaskRunner(files: IntakeDirectory, workspace: undefined | WorkspaceYaml): TaskRunner {
  if (getEntry(files, 'turbo.json')) {
    return 'turbo';
  }

  if (getEntry(files, 'nx.json')) {
    return 'nx';
  }

  return workspace?.tasks ? 'pnpm' : 'none';
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

  return usesPrettier && !usesOxfmt ? { formatter: 'prettier' } : {};
}

/**
 * Infers the root Vitest config's file name, when it isn't vitest.config.ts.
 */
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
  return name ? { vitestConfig: name } : {};
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

  const readme = readText(files, 'README.md') ?? '';
  const tagline =
    /<p align="center">([^<]+)<\/p>/.exec(readme)?.[1] ??
    readme
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line && !/^[#<!>[|`-]/.test(line));

  return tagline ? { description: tagline.trim() } : {};
}
