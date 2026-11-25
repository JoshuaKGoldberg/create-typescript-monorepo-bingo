import { z } from 'zod';

import { rootBase } from '../../bases/rootBase.ts';
import { parseJsonText, readText } from '../../utils/files.ts';
import { formatJson, withDefaults } from '../../utils/json.ts';
import { getBuildPackageName, getPackageGlobs } from '../../utils/options.ts';
import { emitsFiles } from '../../utils/tsconfig.ts';

interface TSConfigReference {
  path: string;
}

export const blockRootTSConfig = rootBase.createBlock({
  about: {
    name: 'Root TSConfig',
  },
  intake({ files }) {
    const existing = readText(files, 'tsconfig.json');
    const manifest = parseJsonText(readText(files, 'package.json'));
    const rootType = manifest.type;
    return {
      ...(existing !== undefined && { existing }),
      ...(emitsFiles(
        parseJsonText(existing).compilerOptions,
        Object.values((manifest.scripts ?? {}) as Record<string, string>),
      ) && { emits: true }),
      // Without "type": "module", NodeNext doesn't allow import.meta in root config files
      ...(readText(files, 'package.json') !== undefined &&
        rootType !== 'module' && { rootNotModule: true }),
      ...(readText(files, 'packages/build/package.json') !== undefined && {
        hasBuildPackage: true,
      }),
    };
  },
  props: {
    emits: z.boolean().optional(),
    existing: z.string().optional(),
    hasBuildPackage: z.boolean().optional(),
    include: z.array(z.string()).optional(),
    references: z.array(z.string()).optional(),
    rootNotModule: z.boolean().optional(),
    addsConfigFiles: z.boolean().optional(),
  },
  produce({ options, props }) {
    if (options.buildPackageSkipped) {
      return {};
    }

    const hasBuildPackage =
      !!props.hasBuildPackage || (options.packages ?? []).some((pkg) => pkg.kind === 'library');
    if (props.existing !== undefined && !hasBuildPackage && !props.addsConfigFiles) {
      return {};
    }

    // Packages would inherit settings added to a root tsconfig.json they extend
    if (options.rootTSConfigExtended) {
      return {
        suggestions: [
          "The root tsconfig.json wasn't changed because packages extend it. Move its shared settings to a tsconfig.base.json and re-run to set up type checking.",
        ],
      };
    }

    const existing = parseJsonText(props.existing);
    const existingOptions = (existing.compilerOptions ?? {}) as Record<string, unknown>;
    const setsModule =
      existingOptions.module !== undefined || existingOptions.moduleResolution !== undefined;
    const existingReferences = (existing.references as TSConfigReference[] | undefined) ?? [];
    const references = existingReferences.map((reference) => reference.path);
    const normalized = new Set(references.map(normalizePath));

    for (const reference of props.references ?? []) {
      if (!normalized.has(normalizePath(reference))) {
        normalized.add(normalizePath(reference));
        const path = `./${normalizePath(reference)}`;
        const sorted =
          references.length > 1 &&
          references.every((item, index) => index === 0 || (references[index - 1] ?? '') <= item);
        const index = sorted ? references.findIndex((item) => item > path) : -1;
        references.splice(index === -1 ? references.length : index, 0, path);
      }
    }

    // Solution-style configs only have references
    const isSolution = Array.isArray(existing.files) && !existing.files.length;
    // Package config files aren't in any package's tsconfig.json
    const packageConfigGlobs =
      props.existing === undefined || hasBuildPackage
        ? getPackageGlobs(options, '*.config.ts').map((glob) => `./${glob}`)
        : [];
    const existingInclude = existing.include as string[] | undefined;
    const narrows =
      props.existing !== undefined &&
      !existingInclude &&
      existing.files === undefined &&
      hasBuildPackage;
    // Config files need to be in a tsconfig.json for typed linting
    const configGlobs = ['./*.config.ts', ...packageConfigGlobs];
    const include = new Set([
      ...(existingInclude ?? configGlobs),
      ...(existingInclude
        ? configGlobs.filter(
            (glob) =>
              !(
                glob === './*.config.ts'
                  ? ['eslint', 'knip', 'oxfmt', 'tsdown', 'vitest'].map(
                      (name) => `${name}.config.ts`,
                    )
                  : [glob.slice(2).replace('*.config', 'tsdown.config').replaceAll('*', 'x')]
              ).every((file) => existingInclude.some((entry) => includeCovers(entry, file))),
          )
        : []),
      ...(props.include ?? []),
    ]);

    return {
      suggestions: [
        ...(props.rootNotModule &&
        setsModule &&
        !/^(?:preserve|system|esnext|es202)/i.test(String(existingOptions.module))
          ? [
              'Root config files that use import.meta will fail to type check. Set "type": "module" in the root package.json, or "module": "preserve" and "moduleResolution": "bundler" in the root tsconfig.json.',
            ]
          : []),
        ...(narrows
          ? [
              'The root tsconfig.json now only includes config files, as packages are type checked through references. Add any other files to its include.',
            ]
          : []),
      ],
      files: {
        'tsconfig.json': formatJson(
          {
            ...(props.existing === undefined &&
              hasBuildPackage && { extends: `${getBuildPackageName(options)}/tsconfig.base.json` }),
            ...existing,
            ...(!isSolution && {
              ...((props.existing === undefined ||
                existing.compilerOptions !== undefined ||
                hasBuildPackage) && {
                compilerOptions: withDefaults(
                  existing.compilerOptions as Record<string, unknown> | undefined,
                  {
                    ...(props.existing === undefined &&
                      !hasBuildPackage && {
                        module: 'NodeNext',
                        moduleResolution: 'NodeNext',
                        skipLibCheck: true,
                        strict: true,
                        target: 'ES2022',
                        types: ['node'],
                      }),
                    // Either one alone is an invalid combination
                    ...(props.rootNotModule &&
                      !setsModule && { module: 'preserve', moduleResolution: 'bundler' }),
                    ...((props.existing === undefined || hasBuildPackage) && {
                      ...(!props.emits && { noEmit: true }),
                      tsBuildInfoFile: 'node_modules/.cache/tsbuild/info.json',
                    }),
                  },
                ),
              }),
              // Adding an include would stop other files from being checked
              ...([
                props.existing === undefined,
                existingInclude,
                existing.files,
                hasBuildPackage,
              ].some(Boolean) && {
                include: [...include],
              }),
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
 * Whether a tsconfig include entry covers a file path, per TypeScript's matching.
 */
function includeCovers(entry: string, file: string): boolean {
  const normalized = entry.replace(/^\.\//, '').replace(/\/$/, '');
  if (normalized === '' || normalized === '.') {
    return true;
  }

  // Paths without an extension are directories
  if (!/[*?]/.test(normalized) && !/\.[cm]?[jt]sx?$/.test(normalized)) {
    return file.startsWith(`${normalized}/`);
  }

  const segments = normalized.split('/');
  // A trailing ** matches every file below it, as **/* does
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
