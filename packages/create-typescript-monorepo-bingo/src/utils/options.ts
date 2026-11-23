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
 * Gets the author object for package.json files, if an author name is known.
 */
export function getAuthor(options: RootOptions): undefined | { email?: string; name: string } {
  return options.author
    ? { name: options.author, ...(options.email && { email: options.email }) }
    : undefined;
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
