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
    const rootType = parseJsonText(readText(files, 'package.json')).type;
    return {
      ...(existing !== undefined && { existing }),
      // Without "type": "module", NodeNext treats root config files as CommonJS, where
      // import.meta, as in CTM's vitest.config.ts, isn't allowed.
      ...(readText(files, 'package.json') !== undefined &&
        rootType !== 'module' && { rootNotModule: true }),
      ...(readText(files, 'packages/build/package.json') !== undefined && {
        hasBuildPackage: true,
      }),
    };
  },
  props: {
    existing: z.string().optional(),
    hasBuildPackage: z.boolean().optional(),
    include: z.array(z.string()).optional(),
    references: z.array(z.string()).optional(),
    rootNotModule: z.boolean().optional(),
  },
  produce({ options, props }) {
    // Packages that extend the root tsconfig.json would inherit what CTM adds to it, like
    // noEmit and include, so it's left as it is.
    if (options.rootTSConfigExtended) {
      return {
        suggestions: [
          "Packages extend the root tsconfig.json, so CTM left it as it is and didn't add a tsc -b typecheck. Move the shared settings to a base config, like tsconfig.base.json, for CTM to manage the root tsconfig.json's project references and type checking of root config files.",
        ],
      };
    }

    const existing = parseJsonText(props.existing);
    const existingReferences = (existing.references as TSConfigReference[] | undefined) ?? [];
    const references = existingReferences.map((reference) => reference.path);
    const normalized = new Set(references.map(normalizePath));

    for (const reference of props.references ?? []) {
      if (!normalized.has(normalizePath(reference))) {
        normalized.add(normalizePath(reference));
        // A sorted list stays sorted.
        const path = `./${normalizePath(reference)}`;
        const sorted =
          references.length > 1 &&
          references.every((item, index) => index === 0 || (references[index - 1] ?? '') <= item);
        const index = sorted ? references.findIndex((item) => item > path) : -1;
        references.splice(index === -1 ? references.length : index, 0, path);
      }
    }

    const hasBuildPackage =
      !!props.hasBuildPackage || (options.packages ?? []).some((pkg) => pkg.kind === 'library');

    // A solution-style config, with no files of its own, only gets references.
    const isSolution = Array.isArray(existing.files) && !existing.files.length;
    // Package config files, like tsdown.config.ts, aren't in any package's tsconfig.
    const packageConfigGlobs = getPackageGlobs(options, '*.config.ts').map((glob) => `./${glob}`);
    const existingInclude = existing.include as string[] | undefined;
    // Config files, like CTM's eslint.config.ts, need a tsconfig for typed linting: an
    // existing include gets the globs for any it doesn't already cover.
    const configGlobs = ['./*.config.ts', ...packageConfigGlobs];
    const include = new Set([
      ...(existingInclude ?? configGlobs),
      ...(existingInclude
        ? configGlobs.filter(
            (glob) =>
              !existingInclude.some((entry) =>
                // A config CTM writes there: eslint.config.ts, or packages/x/tsdown.config.ts.
                includeCovers(
                  entry,
                  glob === './*.config.ts'
                    ? 'eslint.config.ts'
                    : glob.slice(2).replace('*.config', 'tsdown.config').replaceAll('*', 'x'),
                ),
              ),
          )
        : []),
      ...(props.include ?? []),
    ]);

    return {
      files: {
        'tsconfig.json': formatJson(
          {
            // Only a new file extends the build package's base, and only if there is one.
            ...(props.existing === undefined &&
              hasBuildPackage && { extends: `${getBuildPackageName(options)}/tsconfig.base.json` }),
            ...existing,
            // Existing compiler options are the repository's.
            ...(!isSolution && {
              compilerOptions: withDefaults(
                existing.compilerOptions as Record<string, unknown> | undefined,
                {
                  // Without a build package's base, a new file stands on its own.
                  ...(props.existing === undefined &&
                    !hasBuildPackage && {
                      module: 'NodeNext',
                      moduleResolution: 'NodeNext',
                      skipLibCheck: true,
                      strict: true,
                      target: 'ES2022',
                      types: ['node'],
                    }),
                  ...(props.rootNotModule && { module: 'preserve', moduleResolution: 'bundler' }),
                  noEmit: true,
                  tsBuildInfoFile: 'node_modules/.cache/tsbuild/info.json',
                },
              ),
              include: [...include],
            }),
            ...(references.length || existing.references !== undefined
              ? { references: references.map((path) => ({ path })) }
              : {}),
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

/**
 * Whether a tsconfig include entry covers a file path, as TypeScript matches them:
 * `*` and `?` within a path segment, `**` across segments, and plain paths as directories.
 */
function includeCovers(entry: string, file: string): boolean {
  const normalized = entry.replace(/^\.\//, '').replace(/\/$/, '');
  if (normalized === '' || normalized === '.') {
    return true;
  }

  // A plain path without an extension is a directory, like src.
  if (!/[*?]/.test(normalized) && !/\.[cm]?[jt]sx?$/.test(normalized)) {
    return file.startsWith(`${normalized}/`);
  }

  const segments = normalized.split('/');
  // A trailing ** matches every file below it, as **/* does.
  if (segments.at(-1) === '**') {
    segments.push('*');
  }

  const pattern = segments
    .map((segment) =>
      segment === '**'
        ? '(?:[^/]+/)*'
        : `${segment
            .replaceAll(/[.+^${}()|[\]\\]/g, '\\$&')
            .replaceAll('*', '[^/]*')
            .replaceAll('?', '[^/]')}/`,
    )
    .join('')
    .slice(0, -1);
  return new RegExp(`^${pattern}$`).test(file);
}
