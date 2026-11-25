import type { IntakeDirectory } from 'bingo-fs';
import ignoreMatcher from 'ignore';
import { z } from 'zod';

import { rootBase } from '../../bases/rootBase.ts';
import { readText } from '../../utils/files.ts';
import { getPackageParents } from '../../utils/options.ts';

const anchoredNodeModules = new Set(['/node_modules', '/node_modules/']);

/**
 * Entries are unanchored so that `node_modules/` also ignores packages' directories.
 */
export const blockGitignore = rootBase.createBlock({
  about: {
    name: 'Gitignore',
  },
  intake({ files }) {
    const existing = readText(files, '.gitignore');
    return {
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

      // dist and lib are in packages, while other outputs are only in the root
      const isPackageOutput = name === 'dist' || name === 'lib';
      const samples = isPackageOutput
        ? parents.map((parent) => `${parent}/package/${name}/file`)
        : [`${name}/file`];
      if (samples.every((sample) => matcher.ignores(sample))) {
        continue;
      }

      // A bare name could hide a package of that name or a source folder such as src/lib
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

    // An existing entry such as build/ could hide new packages
    const hidden: string[] = [];
    const hasBuild =
      !options.buildPackageSkipped &&
      (options.packages ?? []).some((pkg) => pkg.kind === 'library');
    for (const pkg of options.packages ?? []) {
      const isHidden = () =>
        ignoreMatcher().add(lines.join('\n')).ignores(`${pkg.directory}/package.json`);
      if (((pkg.kind === 'build' && hasBuild) || pkg.name === options.newPackage) && isHidden()) {
        lines.push(`!${pkg.directory}/`);
        // Negations can't reach into ignored parent directories
        if (isHidden()) {
          lines.pop();
          hidden.push(pkg.directory);
        }
      }
    }

    const output = props.existing === undefined ? lines.sort() : lines;

    const text = `${output.join('\n')}\n`;
    return {
      files: {
        '.gitignore': text.trimEnd() === props.existing?.trimEnd() ? props.existing : text,
      },
      suggestions: [
        ...skipped.map(
          (ignore) =>
            `${ignore} wasn't added to .gitignore because it would ignore existing package files. Ignore build outputs another way.`,
        ),
        ...hidden.map(
          (directory) => `${directory} is ignored by .gitignore. Remove the entry that ignores it.`,
        ),
      ],
    };
  },
});

/**
 * Normalizes equivalent patterns, such as `dist`, `dist/`, and `**\/dist`.
 */
function normalizeIgnore(pattern: string) {
  return pattern.replace(/^\*\*\//, '').replace(/\/$/, '');
}

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
