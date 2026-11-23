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
      packageDirectories: [...collectPackageDirectories(files)],
      ...(existing !== undefined && { existing }),
    };
  },
  props: {
    directories: z.array(z.string()).optional(),
    existing: z.string().optional(),
    ignores: z.array(z.string()).optional(),
    packageDirectories: z.array(z.string()).optional(),
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
    const directories = new Set(props.directories);
    const packageDirectories = new Set(props.packageDirectories);
    const skipped: string[] = [];

    for (const ignore of ['node_modules/', ...(props.ignores ?? [])]) {
      const name = normalizeIgnore(ignore);
      const matcher = ignoreMatcher().add(lines.join('\n'));

      // Covered if build outputs at the root and in packages are already ignored,
      // by whatever patterns the repository uses.
      const samples = [
        `${name}/file`,
        ...parents.map((parent) => `${parent}/package/${name}/file`),
      ];
      if (samples.every((sample) => matcher.ignores(sample))) {
        continue;
      }

      // A bare name would also hide a package with that name, or source folders like
      // src/lib, so those get precise per-package globs instead.
      if (name !== 'node_modules' && (directories.has(name) || packageNames.has(name))) {
        const precise = parents.map((parent) => `${parent}/*/${name}/`);
        if (precise.some((glob) => packageDirectories.has(glob.slice(0, -1)))) {
          skipped.push(ignore);
          continue;
        }

        lines.push(...precise.filter((glob) => !matcher.ignores(glob.replace('*', 'package'))));
        continue;
      }

      lines.push(ignore);
    }

    // A fresh file is kept sorted; an existing one only gets appended to.
    const output = props.existing === undefined ? lines.sort() : lines;

    const text = `${output.join('\n')}\n`;
    return {
      files: {
        // Written back exactly as it was when nothing is added.
        '.gitignore': text.trimEnd() === props.existing?.trimEnd() ? props.existing : text,
      },
      suggestions: skipped.map(
        (ignore) =>
          `${ignore} wasn't added to .gitignore, because package directories with that name hold files in this repository. Ignore build outputs another way.`,
      ),
    };
  },
});

/**
 * Normalizes an ignore pattern for comparison: \`dist\`, \`dist/\`, \`**\/dist\` and
 * \`**\/dist/\` are the same.
 */
function normalizeIgnore(pattern: string) {
  return pattern.replace(/^\*\*\//, '').replace(/\/$/, '');
}

function collectDirectoryNames(
  directory: IntakeDirectory | undefined,
  names = new Set<string>(),
): Set<string> {
  for (const [name, entry] of Object.entries(directory ?? {})) {
    if (entry && !Array.isArray(entry) && name !== 'node_modules' && name !== '.git') {
      if (Object.keys(entry).length) {
        names.add(name);
      }
      collectDirectoryNames(entry, names);
    }
  }
  return names;
}

function collectPackageDirectories(files: IntakeDirectory | undefined): Set<string> {
  const patterns = new Set<string>();
  for (const [parent, parentEntry] of Object.entries(files ?? {})) {
    if (!parentEntry || Array.isArray(parentEntry) || parent === 'node_modules') {
      continue;
    }

    for (const packageEntry of Object.values(parentEntry)) {
      if (!packageEntry || Array.isArray(packageEntry)) {
        continue;
      }

      for (const [name, entry] of Object.entries(packageEntry)) {
        if (
          entry &&
          !Array.isArray(entry) &&
          Object.keys(entry).length &&
          name !== 'node_modules'
        ) {
          patterns.add(`${parent}/*/${name}`);
        }
      }
    }
  }
  return patterns;
}
