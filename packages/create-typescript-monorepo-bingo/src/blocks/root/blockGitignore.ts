import type { IntakeDirectory } from 'bingo-fs';
import ignoreMatcher from 'ignore';
import { z } from 'zod';

import { rootBase } from '../../bases/rootBase.ts';
import { readText } from '../../utils/files.ts';
import { getPackageParents } from '../../utils/options.ts';

const anchoredNodeModules = new Set(['/node_modules', '/node_modules/']);

/**
 * Owns `.gitignore`. Entries stay unanchored, so `node_modules/` also ignores
 * `packages/*\/node_modules`. Existing entries and comments are kept.
 */
export const blockGitignore = rootBase.createBlock({
  about: {
    name: 'Gitignore',
  },
  intake({ files }) {
    const existing = readText(files, '.gitignore');
    return {
      // Directory names, and packages/*/<name> patterns, that already hold files.
      directories: [...collectDirectoryNames(files)],
      ...(existing !== undefined && { existing }),
    };
  },
  props: {
    directories: z.array(z.string()).optional(),
    existing: z.string().optional(),
    ignores: z.array(z.string()).optional(),
  },
  produce({ options, props }) {
    const lines = (props.existing ?? '')
      .replace(/\n+$/, '')
      .split('\n')
      .filter((line, index, all) => line || all.length > 1)
      .map((line) => (anchoredNodeModules.has(line.trim()) ? 'node_modules/' : line));
    const parents = getPackageParents(options);
    const packageNames = new Set(
      (options.packages ?? []).map((pkg) => pkg.directory.split('/').pop() ?? pkg.directory),
    );
    // Only directories the repository doesn't already ignore, like build outputs, count.
    const existingMatcher = ignoreMatcher().add(lines.join('\n'));
    const trackedDirectories = (props.directories ?? []).filter(
      (path) => !existingMatcher.ignores(`${path}/`),
    );
    const directories = new Set(trackedDirectories.map((path) => path.split('/').pop() ?? path));
    const packageDirectories = new Set(
      trackedDirectories
        .map((path) => path.split('/'))
        .filter((segments) => segments.length === 3)
        .map(([parent = '', , name = '']) => `${parent}/*/${name}`),
    );
    const skipped: string[] = [];

    for (const ignore of ['node_modules/', ...(props.ignores ?? [])]) {
      const name = normalizeIgnore(ignore);
      const matcher = ignoreMatcher().add(lines.join('\n'));

      // Package build outputs, like dist and lib, are judged by package paths only; tool
      // folders, like coverage and .nx, only exist at the root.
      const isPackageOutput = name === 'dist' || name === 'lib';
      const samples = isPackageOutput
        ? parents.map((parent) => `${parent}/package/${name}/file`)
        : [`${name}/file`];
      if (samples.every((sample) => matcher.ignores(sample))) {
        continue;
      }

      // A bare name would also hide a package with that name, or source folders like
      // src/lib, so those get precise globs instead.
      if (name !== 'node_modules' && (directories.has(name) || packageNames.has(name))) {
        const precise = isPackageOutput
          ? parents.map((parent) => `${parent}/*/${name}/`)
          : [`/${name}/`];
        if (precise.some((glob) => packageDirectories.has(glob.replace(/\/$/, '')))) {
          skipped.push(ignore);
          continue;
        }

        lines.push(
          ...precise.filter(
            (glob) => !matcher.ignores(glob.replace(/^\//, '').replace('*', 'package')),
          ),
        );
        continue;
      }

      lines.push(ignore);
    }

    // An existing entry, like build/, may hide the directories of packages CTM creates.
    const hidden: string[] = [];
    // Without libraries, there's no build package unless it already exists.
    const hasBuild =
      (!options.typescriptKept || !!options.newPackage) &&
      (options.packages ?? []).some((pkg) => pkg.kind === 'library');
    for (const pkg of options.packages ?? []) {
      const isHidden = () =>
        ignoreMatcher().add(lines.join('\n')).ignores(`${pkg.directory}/package.json`);
      if (((pkg.kind === 'build' && hasBuild) || pkg.name === options.newPackage) && isHidden()) {
        lines.push(`!${pkg.directory}/`);
        // A negation can't reach into an ignored parent directory.
        if (isHidden()) {
          lines.pop();
          hidden.push(pkg.directory);
        }
      }
    }

    // A fresh file is kept sorted; an existing one only gets appended to.
    const output = props.existing === undefined ? lines.sort() : lines;

    const text = `${output.join('\n')}\n`;
    return {
      files: {
        // Written back exactly as it was when nothing is added.
        '.gitignore': text.trimEnd() === props.existing?.trimEnd() ? props.existing : text,
      },
      suggestions: [
        ...skipped.map(
          (ignore) =>
            `${ignore} wasn't added to .gitignore, because package directories with that name hold files in this repository. Ignore build outputs another way.`,
        ),
        ...hidden.map(
          (directory) =>
            `.gitignore ignores ${directory}, so its files won't be committed. Change the entry that does.`,
        ),
      ],
    };
  },
});

/**
 * Normalizes an ignore pattern for comparison: `dist`, `dist/`, `**\/dist` and
 * `**\/dist/` are the same.
 */
function normalizeIgnore(pattern: string) {
  return pattern.replace(/^\*\*\//, '').replace(/\/$/, '');
}

/**
 * Collects the paths of directories that hold files.
 */
function collectDirectoryNames(
  directory: IntakeDirectory | undefined,
  paths = new Set<string>(),
  prefix = '',
): Set<string> {
  for (const [name, entry] of Object.entries(directory ?? {})) {
    if (entry && !Array.isArray(entry) && name !== 'node_modules' && name !== '.git') {
      if (Object.keys(entry).length) {
        paths.add(`${prefix}${name}`);
      }
      collectDirectoryNames(entry, paths, `${prefix}${name}/`);
    }
  }
  return paths;
}
