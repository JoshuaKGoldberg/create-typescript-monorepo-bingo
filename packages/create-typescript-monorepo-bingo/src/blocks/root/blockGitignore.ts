import type { IntakeDirectory } from 'bingo-fs';
import { z } from 'zod';

import { rootBase } from '../../bases/rootBase.ts';
import { readText } from '../../utils/files.ts';

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
    // Directory names that already hold files in the repository, which an ignore would hide.
    const directories = [...collectDirectoryNames(files)];
    return { directories, ...(existing !== undefined && { existing }) };
  },
  props: {
    directories: z.array(z.string()).optional(),
    existing: z.string().optional(),
    ignores: z.array(z.string()).optional(),
  },
  produce({ props }) {
    const lines = (props.existing ?? '')
      .replace(/\n+$/, '')
      .split('\n')
      .filter((line, index, all) => line || all.length > 1)
      .map((line) => (anchoredNodeModules.has(line.trim()) ? 'node_modules/' : line));
    const present = new Set(lines.map((line) => normalizeIgnore(line.trim())));
    const directories = new Set(props.directories);
    const skipped: string[] = [];

    for (const ignore of ['node_modules/', ...(props.ignores ?? [])]) {
      const normalized = normalizeIgnore(ignore);
      if (
        present.has(normalized) ||
        // .nx/* covers .nx/, and packages/*/lib covers lib/.
        [...present].some(
          (line) => line.startsWith(`${normalized}/`) || line.endsWith(`/${normalized}`),
        )
      ) {
        continue;
      }

      // An ignore like lib/ would hide existing files, such as source code in a src/lib.
      if (directories.has(normalized)) {
        skipped.push(ignore);
        continue;
      }

      present.add(normalized);
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
          `${ignore} wasn't added to .gitignore, because directories with that name hold files in this repository. Ignore build outputs more precisely, like packages/*/${ignore}.`,
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
