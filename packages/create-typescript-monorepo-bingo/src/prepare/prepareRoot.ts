import path from 'node:path';

import type { TemplatePrepareContext } from 'bingo';
import type { CreatedDirectory, IntakeDirectory } from 'bingo-fs';
import { parse as parseYaml } from 'yaml';

import type { CatalogMode, PackageKind, PackageSpec, RootOptions, TaskRunner } from '../options.ts';
import { type DependencyField, dependencyFields } from '../utils/catalogs.ts';
import { type Choices, readChoices } from '../utils/choices.ts';
import {
  getDirectory,
  getEntry,
  isOwnedFile,
  parseJsonText,
  readJson,
  readText,
} from '../utils/files.ts';
import { hasSortedKeysDeep } from '../utils/json.ts';
import { pin, tryPin } from '../utils/pins.ts';
import {
  getMinimumVersion,
  isProtocolSpecifier,
  parseNpmAlias,
  resolveSpecifier,
} from '../utils/versions.ts';

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
    ...(!('typescript7Alias' in inferTypeScript7Alias(rootManifest, workspace)) &&
      keepsTypeScript(files, rootManifest) && {
        typescriptKept: true,
        // An older tsc may reject the build package's sources
        ...(readText(files, 'packages/build/package.json') === undefined && {
          buildPackageSkipped: true,
        }),
      }),
    ...inferChoices(files, rootManifest, workspacePackages),
    // Explicit choices may not be shown by files alone
    ...readChoices(files),
    ...inferVitestConfig(files),
    ...inferSetupAction(files),
    ...inferWorkflowExtension(files),
    ...inferWorkflowKeysSorted(files),
  };
}

function inferChoices(
  files: IntakeDirectory,
  manifest: PackageManifest | undefined,
  packages: WorkspacePackage[],
): Choices {
  return {
    ...inferFormatter(files, manifest),
    ...inferTestRunner(files, manifest, packages),
  };
}

/**
 * Finds choices that later transitions wouldn't be able to infer.
 */
export function findExplicitChoices(files: IntakeDirectory, options: RootOptions): Choices {
  const formatter = options.formatter ?? 'oxfmt';
  const linter = options.linter ?? 'eslint';
  const testRunner = options.testRunner ?? 'vitest';
  const explicit: Choices = { ...(linter !== 'eslint' && { linter }) };

  if (!Object.keys(files).length) {
    return explicit;
  }

  const written: IntakeDirectory = {
    ...files,
    ...(formatter === 'oxfmt' && { 'oxfmt.config.ts': [''] }),
    ...(formatter === 'prettier' && { '.prettierrc': [''] }),
    ...(testRunner === 'vitest' && { 'vitest.config.ts': [''] }),
  };
  const inferred: Choices = {
    formatter: 'oxfmt',
    testRunner: 'vitest',
    ...inferChoices(
      written,
      readJson(files, 'package.json'),
      findWorkspacePackages(files, readWorkspaceYaml(files)?.packages ?? ['packages/*']),
    ),
  };
  // Files written by CTM can otherwise make a remembered choice look inferred
  const remembered = readChoices(files);
  return {
    ...((formatter !== inferred.formatter || formatter === remembered.formatter) && { formatter }),
    ...explicit,
    ...((testRunner !== inferred.testRunner || testRunner === remembered.testRunner) && {
      testRunner,
    }),
  };
}

/**
 * Whether TypeScript is older than 6, or tsconfigs use options removed in TypeScript 7.
 */
function keepsTypeScript(files: IntakeDirectory, manifest: PackageManifest | undefined) {
  const typescript = manifest && getAllDependencies(manifest).typescript;
  const minimum = getMinimumVersion(
    'typescript',
    typescript,
    readText(files, 'pnpm-workspace.yaml'),
  );
  return (
    !!minimum &&
    (minimum.major < 6 ||
      ignoresDeprecations(files) ||
      Object.values(manifest?.scripts ?? {}).some((script) =>
        script.includes('--ignoreDeprecations'),
      ))
  );
}

function ignoresDeprecations(directory: IntakeDirectory): boolean {
  return Object.entries(directory).some(([name, entry]) => {
    if (!entry) {
      return false;
    }

    if (!Array.isArray(entry)) {
      return name !== 'node_modules' && !/fixture/i.test(name) && ignoresDeprecations(entry);
    }

    if (!/^(?:ts|js)config.*\.json$/.test(name)) {
      return false;
    }

    try {
      const { compilerOptions } = parseJsonText(entry[0], name);
      const value = (compilerOptions as Record<string, unknown> | undefined)?.ignoreDeprecations;
      return typeof value === 'string' && value.startsWith('6');
    } catch {
      return false;
    }
  });
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
 * Only single-level globs and exact directories are supported.
 */
export function findWorkspacePackages(
  files: IntakeDirectory | CreatedDirectory,
  globs: string[],
): WorkspacePackage[] {
  const found: WorkspacePackage[] = [];
  // Hand-written lists may have empty items
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
      // Overlapping globs may find a package multiple times
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
    // tsdown's workspace mode skips package configs without their own entry
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
  // Other named catalogs are the repository's own
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

function getWrittenCatalogEntry(dependency: string, specifier: string) {
  const pinned = tryPin(dependency);
  return pinned ? resolveSpecifier(specifier, pinned, dependency) : specifier;
}

/**
 * Finds dependencies declared multiple times, always with the same specifier.
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

  // A literal that differs from the catalog entry is a conflict
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
 * Finds dependencies declared with different specifiers in the same named catalog.
 */
export function findNamedConflicts(
  manifests: ManifestWithKind[],
  catalogs: Partial<Record<string, Record<string, string>>> = {},
): string[] {
  const specifiers = new Map<string, Set<string>>();

  for (const { kind, manifest } of manifests) {
    const record = manifest as Partial<Record<DependencyField, Record<string, string>>>;
    for (const field of dependencyFields) {
      // The build package's runtime dependencies are development tools
      const catalog = kind === 'build' ? 'dev' : namedCatalogs[field];
      if (!catalog) {
        continue;
      }

      for (const [dependency, diskSpecifier] of Object.entries(record[field] ?? {})) {
        if (!isLiteral(diskSpecifier)) {
          continue;
        }

        // A version CTM is about to change shouldn't count as a conflict
        const specifier = getWrittenSpecifier(kind, field, dependency, diskSpecifier);
        const key = `${catalog}:${dependency}`;
        specifiers.set(key, (specifiers.get(key) ?? new Set()).add(specifier));
      }
    }
  }

  // A literal that differs from the catalog entry is a conflict
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
 * Approximates the specifier that Blocks will write.
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
  const person = manifest?.author;
  if (!person) {
    return undefined;
  }

  if (typeof person === 'string') {
    // "Name <email> (url)", parsed without backtracking-prone patterns
    const name = person.split(/[<(]/)[0]?.trim();
    const email = /<([^>]+)>/.exec(person)?.[1];
    return name ? { email, name } : undefined;
  }

  return person;
}

function parseRepository(repository: PackageManifest['repository']) {
  const url = typeof repository === 'string' ? repository : repository?.url;
  // Full URLs, or npm's "owner/repo" and "github:owner/repo" shorthands
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

  // Recursive builds alone may have been written by CTM for packages tsdown would skip
  return workspace?.tasks || recursivePnpm.test(manifest?.scripts?.test ?? '') ? 'pnpm' : 'none';
}

const recursivePnpm = /\bpnpm\b[^&|;]*\s(?:-r|--recursive|-F|--filter)\b/;

function buildsLibrariesRecursively(script: string | undefined, packages: PackageSpec[]) {
  const libraries = packages.filter((pkg) => pkg.kind === 'library');

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
        // Negations and `docs...` filters can include libraries
        if (filter.startsWith('!') || filter.endsWith('...')) {
          return true;
        }

        // Path filters are relative to the root, while others match names
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
    // The specifier may be a catalog reference
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

  // An unrelated deploy.yml shouldn't cause a second copy of every workflow
  for (const name of ['ci', 'release', 'octoguide', 'contributors']) {
    for (const workflowExtension of ['yaml', 'yml'] as const) {
      if (getEntry(workflows, `${name}.${workflowExtension}`)) {
        return { workflowExtension };
      }
    }
  }

  const names = Object.keys(workflows);
  return names.length && names.every((name) => name.endsWith('.yml'))
    ? { workflowExtension: 'yml' }
    : {};
}

/**
 * Finds an action that can be used in place of CTM's setup action, after a checkout.
 */
function inferSetupAction(files: IntakeDirectory): Partial<RootOptions> {
  const read = (name: string) =>
    readText(files, `.github/actions/${name}/action.yml`) ??
    readText(files, `.github/actions/${name}/action.yaml`);

  const setup = read('setup');
  if (setup !== undefined) {
    return /^[\s-]*uses:\s*['"]?actions\/checkout@/m.test(setup) ? {} : { setupAction: 'setup' };
  }

  const setupAction = Object.keys(getDirectory(files, '.github/actions') ?? {})
    .sort((a, b) => Number(b === 'prepare') - Number(a === 'prepare'))
    .find((name) => onlyInstalls(parseYamlObject(read(name))));
  return setupAction ? { setupAction } : {};
}

const installActions = /^(?:actions\/cache|actions\/setup-node|pnpm\/action-setup|pnpm\/setup)@/;

function onlyInstalls(action: object) {
  const { inputs, runs } = action as {
    inputs?: Record<string, null | { required?: unknown }>;
    runs?: { steps?: unknown; using?: unknown };
  };
  if (
    runs?.using !== 'composite' ||
    !Array.isArray(runs.steps) ||
    Object.values(inputs ?? {}).some((input) => input?.required)
  ) {
    return false;
  }

  const steps = runs.steps as (null | Record<string, unknown>)[];
  const setups = steps.slice(0, -1);
  const install = steps.at(-1);
  return (
    !!install &&
    /^pnpm (?:i|install)(?: --frozen-lockfile)?$/.test(String(install.run).trim()) &&
    install.if === undefined &&
    install['working-directory'] === undefined &&
    setups.every((step) => installActions.test(String(step?.uses))) &&
    setups.some((step) => String(step?.uses).startsWith('pnpm/'))
  );
}

function inferWorkflowKeysSorted(files: IntakeDirectory): Partial<RootOptions> {
  const workflows = Object.entries(getDirectory(files, '.github/workflows') ?? {})
    .filter(([name]) => /\.ya?ml$/.test(name))
    .flatMap(([, entry]) => (Array.isArray(entry) ? [parseYamlObject(entry[0])] : []));
  return workflows.some((workflow) => Object.keys(workflow).length > 1) &&
    workflows.every(hasSortedKeysDeep)
    ? { workflowKeysSorted: true }
    : {};
}

function parseYamlObject(text: string | undefined): object {
  try {
    const value: unknown = text === undefined ? undefined : parseYaml(text);
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function assertMonorepoRoot(manifest: PackageManifest | undefined) {
  const root = manifest as (PackageManifest & Record<string, unknown>) | undefined;
  if (root && !root.private && (root.main || root.exports || root.bin || root.module)) {
    throw new Error(
      `The root package.json is a published package${root.name ? ` (${root.name})` : ''}. Add "private": true if it isn't published, or see create-typescript-app for single-package repositories.`,
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

  const biomeConfig = readText(files, 'biome.json') ?? readText(files, 'biome.jsonc');
  if (usesOxfmt) {
    return {};
  }

  // Biome might be used just for linting
  const biomeFormatter = parseJsonText(biomeConfig, 'biome.json').formatter as
    | undefined
    | { enabled?: boolean };
  const formatsWithBiome =
    ('@biomejs/biome' in dependencies || biomeConfig !== undefined) &&
    biomeFormatter?.enabled !== false;

  // Unknown formatters, such as dprint or ESLint Stylistic, should be left alone
  return { formatter: usesPrettier ? 'prettier' : formatsWithBiome ? 'biome' : 'none' };
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
    ...((name !== undefined || (existing !== undefined && !isOwnedFile(existing))) && {
      vitestConfigUnowned: true,
    }),
  };
}

/**
 * Transitions shouldn't need to prompt for a description.
 */
function inferDescription(
  files: IntakeDirectory,
  manifest: PackageManifest | undefined,
): Partial<RootOptions> {
  if (manifest?.description) {
    return { description: manifest.description };
  }

  // Finds a centered tagline or first paragraph
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
 * Task runner test scripts, such as `turbo run test`, defer to packages' own scripts.
 */
function inferTestRunner(
  files: IntakeDirectory,
  manifest: PackageManifest | undefined,
  packages: WorkspacePackage[],
): Partial<RootOptions> {
  // Scripts are checked first because there may be a leftover Vitest config
  const test: string | undefined = manifest?.scripts?.test;
  const delegates = /\b(?:turbo|nx|lerna)\b/.test(test ?? '') || recursivePnpm.test(test ?? '');
  if (
    test !== undefined &&
    !delegates &&
    !test.includes('vitest') &&
    !(manifest && 'vitest' in getAllDependencies(manifest))
  ) {
    return { testRunner: 'other' };
  }

  if (getEntry(files, 'vitest.config.ts') || inferVitestConfig(files).vitestConfig) {
    return {};
  }

  // A new root config could change which files are tests
  const hasTests = (candidate: PackageManifest | undefined) =>
    !!candidate &&
    ('vitest' in getAllDependencies(candidate) ||
      Object.entries(candidate.scripts ?? {}).some(
        ([name, script]) => /^test\b/.test(name) || /\bvitest\b/.test(script),
      ));
  if (
    hasTests(manifest) ||
    Object.keys(files).some((name) => name.startsWith('vitest.workspace.')) ||
    packages.some(
      (pkg) =>
        hasTests(pkg.manifest) ||
        Object.keys(pkg.files).some((name) => name.startsWith('vitest.config.')) ||
        /"test"\s*:|\bvitest\b/.test(readText(pkg.files, 'project.json') ?? ''),
    )
  ) {
    return { testRunner: 'other' };
  }

  // Repositories managed without Vitest should stay that way
  const managed = ['eslint.config.ts', 'packages/build/src/tsdown/base.ts'].some((path) => {
    const text = readText(files, path);
    // Missing files also count as owned
    return text !== undefined && isOwnedFile(text);
  });
  return managed ? { testRunner: 'other' } : {};
}
