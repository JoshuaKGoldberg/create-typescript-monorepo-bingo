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

export const blockPackageTSConfig = packageBase.createBlock({
  about: {
    name: 'Package TSConfig',
  },
  intake({ files }) {
    const existing = readText(files, 'tsconfig.json');
    if (existing !== undefined) {
      return { existing };
    }

    // Existing packages without a tsconfig.json use one above them
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

    // Only tsconfigs that extend the build package's base are managed by CTM
    const extendsBuild = [existing.extends]
      .flat()
      .some((base) => typeof base === 'string' && base.includes('/build/tsconfig'));
    if (props.existing !== undefined && !extendsBuild) {
      return {};
    }

    // Solution-style tsconfigs have no files of their own
    if (
      (Array.isArray(existing.include) && !existing.include.length) ||
      (Array.isArray(existing.files) && !existing.files.length)
    ) {
      return {};
    }

    // Referenced packages must be composite, as the build package's base is
    const libraries = new Map(
      (options.packages ?? [])
        .filter(
          (other) =>
            other.kind === 'library' &&
            (!!other.extendsBuildTSConfig || other.name === options.newPackage),
        )
        .map((other) => [other.name, other]),
    );
    // Tools such as Nx's TypeScript sync expect a reference to the build package
    const buildPackage = (options.packages ?? []).find((other) => other.kind === 'build');
    const computed = [
      ...(props.existing === undefined && buildPackage ? [buildPackage] : []),
      ...(pkg.workspaceDependencies ?? [])
        .map((dependency) => libraries.get(dependency))
        .filter((dependency) => dependency !== undefined),
    ].map((dependency) => relativeTo(pkg.directory, dependency.directory));

    const existingPaths = (existing.references ?? []).map((reference) => reference.path);
    // A reference to ../x/tsconfig.src.json already covers ../x
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
      ...(props.existing === undefined && { types: ['node'] }),
    });

    if (pkg.isolatedDeclarations) {
      compilerOptions.isolatedDeclarations = true;
    } else {
      delete compilerOptions.isolatedDeclarations;
    }

    return {
      // Some repositories intentionally leave packages out of root references
      extensions:
        props.existing === undefined
          ? [
              asPackageExtension(blockRootTSConfig({ references: [pkg.directory] })),
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
