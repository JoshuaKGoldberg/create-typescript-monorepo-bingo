import { z } from 'zod';

import { rootBase } from '../../bases/rootBase.ts';
import { defaults } from '../../options.ts';
import { type Dependencies, resolveDependencies } from '../../utils/catalogs.ts';
import { parseJsonText, readText } from '../../utils/files.ts';
import { formatPackageJson, sortKeys } from '../../utils/json.ts';
import { getAuthor, getRepositoryUrl } from '../../utils/options.ts';
import { blockPnpmWorkspace } from './blockPnpmWorkspace.ts';

const dependenciesSchema = z.record(z.string(), z.string());

/**
 * Owns the root, private `package.json`: scripts, devDependencies and tool settings.
 * Keys and scripts it doesn't know about are kept from the existing file.
 */
export const blockRootPackageJson = rootBase.createBlock({
  about: {
    name: 'Root package.json',
  },
  intake({ files }) {
    const existing = readText(files, 'package.json');
    return existing === undefined ? undefined : { existing };
  },
  props: {
    devDependencies: dependenciesSchema.optional(),
    existing: z.string().optional(),
    properties: z.record(z.string(), z.unknown()).optional(),
    removedDevDependencies: z.array(z.string()).optional(),
    scripts: z.record(z.string(), z.string()).optional(),
  },
  produce({ options, props }) {
    const existing = parseJsonText(props.existing);
    const existingDevDependencies = { ...(existing.devDependencies as Dependencies | undefined) };
    for (const removed of props.removedDevDependencies ?? []) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete existingDevDependencies[removed];
    }

    const { catalogEntries, dependencies } = resolveDependencies(
      // Root-only devDependencies aren't cataloged in default mode: they're declared once.
      options,
      'devDependencies',
      existingDevDependencies,
      props.devDependencies,
    );

    const packageJson = {
      ...(props.existing === undefined
        ? {
            name: `${options.repository}-monorepo`,
            version: '0.0.0',
            description: options.description,
            repository: { type: 'git', url: getRepositoryUrl(options) },
            license: 'MIT',
            author: getAuthor(options),
            type: 'module',
          }
        : existing),
      private: true,
      ...props.properties,
      scripts: sortKeys(mergeScripts(existing.scripts as Record<string, string>, props.scripts)),
      devDependencies: sortKeys(dependencies),
      packageManager: `pnpm@${options.pnpm ?? defaults.pnpm}`,
      engines: {
        ...(existing.engines as object | undefined),
        node: options.nodeEngines ?? defaults.nodeEngines,
      },
    };

    return {
      extensions: catalogEntries.length ? [blockPnpmWorkspace({ catalogEntries })] : [],
      files: {
        'package.json': formatPackageJson(packageJson, props.existing),
      },
    };
  },
  setup() {
    return {
      scripts: [{ commands: ['pnpm install'], phase: 0 }],
    };
  },
  transition() {
    return {
      scripts: [{ commands: ['pnpm install'], phase: 0 }],
    };
  },
});

/**
 * Applies CTM's scripts over existing ones. An existing script that runs the same
 * command through `pnpm`, like `pnpm tsc -b` for `tsc -b`, is kept as it is.
 */
function mergeScripts(
  existing: Record<string, string> | undefined,
  ours: Record<string, string> | undefined,
): Record<string, string> {
  const merged = { ...existing };

  for (const [name, command] of Object.entries(ours ?? {})) {
    if (merged[name] !== `pnpm ${command}`) {
      merged[name] = command;
    }
  }

  return merged;
}
