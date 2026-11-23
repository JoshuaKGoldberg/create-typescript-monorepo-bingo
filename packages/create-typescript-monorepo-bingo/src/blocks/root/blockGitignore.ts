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
    return existing === undefined ? undefined : { existing };
  },
  props: {
    existing: z.string().optional(),
    ignores: z.array(z.string()).optional(),
  },
  produce({ props }) {
    const lines = (props.existing ?? '')
      .split('\n')
      .filter(Boolean)
      .map((line) => (anchoredNodeModules.has(line.trim()) ? 'node_modules/' : line));
    const present = new Set(lines.map((line) => line.trim()));

    for (const ignore of ['node_modules/', ...(props.ignores ?? [])]) {
      if (!present.has(ignore)) {
        present.add(ignore);
        lines.push(ignore);
      }
    }

    // A fresh file is kept sorted; an existing one only gets appended to.
    const output = props.existing === undefined ? lines.sort() : lines;

    return {
      files: {
        '.gitignore': `${output.join('\n')}\n`,
      },
    };
  },
});
