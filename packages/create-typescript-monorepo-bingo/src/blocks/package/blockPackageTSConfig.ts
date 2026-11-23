import { z } from 'zod';

import { packageBase } from '../../bases/packageBase.ts';
import { asPackageExtension } from '../../production/asRootExtension.ts';
import { parseJsonText, readText } from '../../utils/files.ts';
import { formatJson, withDefaults } from '../../utils/json.ts';
import { mergeList } from '../../utils/lists.ts';
import { getBuildPackageName } from '../../utils/options.ts';
import { blockPnpmWorkspace } from '../root/blockPnpmWorkspace.ts';
import { blockRootTSConfig } from '../root/blockRootTSConfig.ts';

interface TSConfig {
  compilerOptions?: Record<string, unknown>;
  references?: { path: string }[];
}

/**
 * Owns a package's `tsconfig.json`, which extends the build package's base and
 * references the workspace packages it depends on. Adds the package to the root
 * tsconfig's references, so `tsc -b` covers it.
 */
export const blockPackageTSConfig = packageBase.createBlock({
  about: {
    name: 'Package TSConfig',
  },
  intake({ files }) {
    const existing = readText(files, 'tsconfig.json');
    if (existing !== undefined) {
      return { existing };
    }

    // An existing package without a tsconfig uses one above it, like the root's.
    return readText(files, 'package.json') === undefined ? undefined : { inherited: true };
  },
  props: {
    existing: z.string().optional(),
    inherited: z.boolean().optional(),
  },
  produce({ options, props }) {
    const { package: pkg } = options;
    if (props.inherited) {
      return {};
    }

    const existing = parseJsonText(props.existing) as TSConfig & Record<string, unknown>;

    // A solution-style tsconfig, with no files of its own, is the package's own layout.
    if (
      (Array.isArray(existing.include) && !existing.include.length) ||
      (Array.isArray(existing.files) && !existing.files.length)
    ) {
      return {};
    }

    const libraries = new Map(
      (options.packages ?? [])
        .filter((other) => other.kind === 'library')
        .map((other) => [other.name, other]),
    );
    // A new package depends on the build package too, which tools like nx's TypeScript
    // sync expect a reference for; existing packages keep their own references.
    const buildPackage = (options.packages ?? []).find((other) => other.kind === 'build');
    const computed = [
      ...(props.existing === undefined && buildPackage ? [buildPackage] : []),
      ...(pkg.workspaceDependencies ?? [])
        .map((dependency) => libraries.get(dependency))
        .filter((dependency) => dependency !== undefined),
    ].map((dependency) => relativeTo(pkg.directory, dependency.directory));

    // Existing references keep their order; newly needed ones are appended.
    const existingPaths = (existing.references ?? []).map((reference) => reference.path);
    // A reference to ../x/tsconfig.src.json already covers ../x.
    const covered = new Set(
      existingPaths.map((path) => path.replace(/\/tsconfig[^/]*\.json$/, '')),
    );
    const references = mergeList(
      existingPaths.length ? existingPaths : undefined,
      computed.filter((path) => !covered.has(path)),
      () => 0,
    );

    const compilerOptions: Record<string, unknown> = withDefaults(existing.compilerOptions, {
      outDir: 'lib',
      rootDir: 'src',
      tsBuildInfoFile: 'node_modules/.cache/tsbuild/info.src.json',
      // Existing packages keep their own choice of whether to use Node.js types.
      ...(props.existing === undefined && { types: ['node'] }),
    });

    if (pkg.isolatedDeclarations) {
      compilerOptions.isolatedDeclarations = true;
    } else {
      delete compilerOptions.isolatedDeclarations;
    }

    return {
      // Only new packages are added to the root references: existing ones keep the root
      // tsconfig's choice, since some repositories leave packages out on purpose.
      extensions:
        props.existing === undefined
          ? [
              asPackageExtension(blockRootTSConfig({ references: [pkg.directory] })),
              // A new package needs a workspace glob that covers its directory.
              asPackageExtension(blockPnpmWorkspace({ packages: [pkg.directory] })),
            ]
          : [],
      files: {
        'tsconfig.json': formatJson(
          {
            extends: `${getBuildPackageName(options)}/tsconfig.base.json`,
            ...existing,
            compilerOptions,
            include: existing.include ?? ['src'],
            ...(references.length && { references: references.map((path) => ({ path })) }),
          },
          props.existing,
        ),
      },
    };
  },
});

function relativeTo(from: string, to: string) {
  const fromSegments = from.split('/');
  const toSegments = to.split('/');
  let common = 0;
  while (fromSegments[common] === toSegments[common]) {
    common += 1;
  }

  return [...fromSegments.slice(common).map(() => '..'), ...toSegments.slice(common)].join('/');
}
