import { defaults, type PackageSpec, type RootOptions } from '../options.ts';

function getScope(options: RootOptions): string {
  return options.scope ?? `@${options.repository}`;
}

export function getBuildPackageName(options: RootOptions): string {
  return `${getScope(options)}/build`;
}

export function getTypeScript7Alias(options: RootOptions): string {
  return options.typescript7Alias ?? defaults.typescript7Alias;
}

export function getWorkflowPath(options: RootOptions, name: string): string {
  return `${name}.${options.workflowExtension ?? defaults.workflowExtension}`;
}

export function getLibraryPackages(options: RootOptions): PackageSpec[] {
  return (options.packages ?? []).filter((pkg) => pkg.kind === 'library');
}

export function getRepositoryUrl(options: RootOptions): string {
  return `https://github.com/${options.owner}/${options.repository}`;
}

/**
 * Attribution is required by eslint-plugin-package-json.
 */
export function getAuthor(options: RootOptions): { email?: string; name: string } {
  return { name: options.author ?? options.owner, ...(options.email && { email: options.email }) };
}

/**
 * Sorts packages after the workspace packages they depend on.
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

export function usesTaskRunner(options: RootOptions): boolean {
  return !!options.taskRunner && options.taskRunner !== 'none';
}

/**
 * Whether packages use their own build scripts, as tsdown's workspace mode may skip some.
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

export function getPackageFilters(options: RootOptions): string {
  return [
    ...getPackageParents(options).map((parent) => `--filter "./${parent}/*"`),
    ...getTopLevelPackages(options).map((directory) => `--filter "./${directory}"`),
  ].join(' ');
}

export function getPackageParents(options: RootOptions): string[] {
  const parents = new Set(
    // The build package is included because tsc -b emits to it
    (options.packages ?? [])
      .map((pkg) => pkg.directory.split('/').slice(0, -1).join('/'))
      .filter(Boolean),
  );
  return parents.size ? [...parents].sort() : ['packages'];
}

export function getPackageGlobs(options: RootOptions, suffix: string): string[] {
  return [
    ...getPackageParents(options).map((parent) => `${parent}/*/${suffix}`),
    ...getTopLevelPackages(options).map((directory) => `${directory}/${suffix}`),
  ];
}

export function getTopLevelPackages(options: RootOptions): string[] {
  return (options.packages ?? [])
    .map((pkg) => pkg.directory)
    .filter((directory) => !directory.includes('/'))
    .sort();
}
