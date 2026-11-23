import { defaults, type PackageSpec, type RootOptions } from '../options.ts';

/**
 * Resolves the npm scope for the private build package, such as `@bingo`.
 */
function getScope(options: RootOptions): string {
  return options.scope ?? `@${options.repository}`;
}

/**
 * Resolves the name of the private build package, such as `@bingo/build`.
 */
export function getBuildPackageName(options: RootOptions): string {
  return `${getScope(options)}/build`;
}

/**
 * Resolves the dependency name that aliases TypeScript 7.
 */
export function getTypeScript7Alias(options: RootOptions): string {
  return options.typescript7Alias ?? defaults.typescript7Alias;
}

/**
 * Resolves a workflow file's path, with the configured extension.
 */
export function getWorkflowPath(options: RootOptions, name: string): string {
  return `${name}.${options.workflowExtension ?? defaults.workflowExtension}`;
}

/**
 * Gets the packages that CTM produces with the package preset.
 */
export function getLibraryPackages(options: RootOptions): PackageSpec[] {
  return (options.packages ?? []).filter((pkg) => pkg.kind === 'library');
}

/**
 * Gets the repository's URL on GitHub.
 */
export function getRepositoryUrl(options: RootOptions): string {
  return `https://github.com/${options.owner}/${options.repository}`;
}

/**
 * Gets the author object for package.json files, falling back to the repository owner,
 * since eslint-plugin-package-json requires attribution.
 */
export function getAuthor(options: RootOptions): { email?: string; name: string } {
  return { name: options.author ?? options.owner, ...(options.email && { email: options.email }) };
}

/**
 * Sorts packages so that each comes after the workspace packages it depends on.
 * Ties keep their given order.
 */
export function sortByDependencies(packages: PackageSpec[]): PackageSpec[] {
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const sorted: PackageSpec[] = [];
  const visited = new Set<PackageSpec>();

  const visit = (pkg: PackageSpec, stack: Set<PackageSpec>) => {
    if (visited.has(pkg) || stack.has(pkg)) {
      return;
    }

    stack.add(pkg);
    for (const dependency of pkg.workspaceDependencies ?? []) {
      const found = byName.get(dependency);
      if (found) {
        visit(found, stack);
      }
    }
    stack.delete(pkg);

    visited.add(pkg);
    sorted.push(pkg);
  };

  for (const pkg of packages) {
    visit(pkg, new Set());
  }

  return sorted;
}

/**
 * Whether an opt-in task runner orchestrates per-package scripts.
 */
export function usesTaskRunner(options: RootOptions): boolean {
  return !!options.taskRunner && options.taskRunner !== 'none';
}

/**
 * Whether packages build with their own scripts: with a task runner, or when tsdown's
 * workspace mode would skip a package config without an entry of its own.
 */
export function buildsPerPackage(options: RootOptions): boolean {
  return (
    usesTaskRunner(options) ||
    !!options.recursiveBuild ||
    (options.packages ?? []).some(
      (pkg) => pkg.kind === 'library' && pkg.tsdownWorkspaceReady === false,
    )
  );
}

/**
 * Creates pnpm filters for every package directory, like `--filter "./packages/*"`.
 */
export function getPackageFilters(options: RootOptions): string {
  return [
    ...getPackageParents(options).map((parent) => `--filter "./${parent}/*"`),
    ...getTopLevelPackages(options).map((directory) => `--filter "./${directory}"`),
  ].join(' ');
}

/**
 * Gets the directories that hold workspace packages, such as `packages` and `apps`.
 */
export function getPackageParents(options: RootOptions): string[] {
  const parents = new Set(
    // Every package's parent, including the build package's, since tsc -b emits there too.
    (options.packages ?? [])
      .map((pkg) => pkg.directory.split('/').slice(0, -1).join('/'))
      .filter(Boolean),
  );
  return parents.size ? [...parents].sort() : ['packages'];
}

/**
 * Gets glob patterns for an output directory, like `dist`, in every package.
 */
export function getPackageGlobs(options: RootOptions, suffix: string): string[] {
  return [
    ...getPackageParents(options).map((parent) => `${parent}/*/${suffix}`),
    ...getTopLevelPackages(options).map((directory) => `${directory}/${suffix}`),
  ];
}

/**
 * Gets packages in top-level directories, like tools, which have no parent to glob.
 */
export function getTopLevelPackages(options: RootOptions): string[] {
  return (options.packages ?? [])
    .map((pkg) => pkg.directory)
    .filter((directory) => !directory.includes('/'))
    .sort();
}
