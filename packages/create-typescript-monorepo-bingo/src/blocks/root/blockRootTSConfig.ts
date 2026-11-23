import { z } from 'zod';

import { rootBase } from '../../bases/rootBase.ts';
import { parseJsonText, readText } from '../../utils/files.ts';
import { formatJson, withDefaults } from '../../utils/json.ts';
import { getBuildPackageName, getPackageGlobs } from '../../utils/options.ts';

interface TSConfigReference {
  path: string;
}

/**
 * Owns the root `tsconfig.json`, which type checks root config files
 * and references every package for `tsc -b`.
 * Existing references keep their order; new ones are appended.
 */
export const blockRootTSConfig = rootBase.createBlock({
  about: {
    name: 'Root TSConfig',
  },
  intake({ files }) {
    const existing = readText(files, 'tsconfig.json');
    return existing === undefined ? undefined : { existing };
  },
  props: {
    existing: z.string().optional(),
    include: z.array(z.string()).optional(),
    references: z.array(z.string()).optional(),
  },
  produce({ options, props }) {
    const existing = parseJsonText(props.existing);
    const existingReferences = (existing.references as TSConfigReference[] | undefined) ?? [];
    const references = existingReferences.map((reference) => reference.path);
    const normalized = new Set(references.map(normalizePath));

    for (const reference of props.references ?? []) {
      if (!normalized.has(normalizePath(reference))) {
        normalized.add(normalizePath(reference));
        references.push(`./${normalizePath(reference)}`);
      }
    }

    // A solution-style config, with no files of its own, only gets references.
    const isSolution = Array.isArray(existing.files) && !existing.files.length;
    const include = new Set([
      ...((existing.include as string[] | undefined) ?? [
        './*.config.ts',
        ...getPackageGlobs(options, 'tsdown.config.ts').map((glob) => `./${glob}`),
      ]),
      ...(props.include ?? []),
    ]);

    return {
      files: {
        'tsconfig.json': formatJson(
          {
            extends: `${getBuildPackageName(options)}/tsconfig.base.json`,
            ...existing,
            // Existing compiler options are the repository's.
            ...(!isSolution && {
              compilerOptions: withDefaults(
                existing.compilerOptions as Record<string, unknown> | undefined,
                { noEmit: true, tsBuildInfoFile: 'node_modules/.cache/tsbuild/info.json' },
              ),
              include: [...include],
            }),
            references: references.map((path) => ({ path })),
          },
          props.existing,
        ),
      },
    };
  },
});

function normalizePath(path: string) {
  return path.replace(/^\.\//, '').replace(/\/$/, '');
}
