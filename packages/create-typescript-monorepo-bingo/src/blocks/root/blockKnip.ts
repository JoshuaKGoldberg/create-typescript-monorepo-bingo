import { z } from 'zod';

import { rootBase } from '../../bases/rootBase.ts';
import { findAlternateConfig, readText, withoutAlternate } from '../../utils/files.ts';
import { mergeList } from '../../utils/lists.ts';
import { pinned } from '../../utils/pins.ts';
import {
  hasComments,
  printStatic,
  readConfigLayout,
  readConfigObject,
  type StaticObject,
} from '../../utils/staticConfig.ts';
import { blockGitHubActionsCI } from './blockGitHubActionsCI.ts';
import { blockRootPackageJson } from './blockRootPackageJson.ts';

/**
 * Owns `knip.config.ts`. Knip detects workspaces from `pnpm-workspace.yaml`,
 * so `workspaces` lists only exceptions. Existing settings are kept.
 */
export const blockKnip = rootBase.createBlock({
  about: {
    name: 'Knip',
  },
  intake({ files }) {
    const alternate = findAlternateConfig(files, 'knip');
    const fromFiles = ((): object | undefined => {
      const existing = readText(files, 'knip.config.ts');
      return existing === undefined ? undefined : { existing };
    })();
    return alternate ? { ...fromFiles, alternate } : fromFiles;
  },
  props: {
    alternate: z.string().optional(),
    existing: z.string().optional(),
    ignoreDependencies: z.array(z.string()).optional(),
    workspaces: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  },
  produce({ props }) {
    const existing = readConfigObject(props.existing) ?? {};
    // A config CTM can't read back statically, or with comments, is the repository's own:
    // CTM leaves it as it is rather than lose what it can't represent.
    const keepExisting =
      props.existing !== undefined &&
      (!readConfigObject(props.existing) || hasComments(props.existing));
    const existingWorkspaces = (existing.workspaces ?? {}) as Record<string, StaticObject>;
    const root = existingWorkspaces['.'] ?? {};
    const rootIgnores = Array.isArray(root.ignoreDependencies)
      ? root.ignoreDependencies.filter((dependency) => typeof dependency === 'string')
      : undefined;

    const workspaces: Record<string, StaticObject> = {
      ...(props.workspaces as Record<string, StaticObject> | undefined),
      ...existingWorkspaces,
      '.': {
        ...root,
        ignoreDependencies: mergeList(rootIgnores, [
          '@changesets/cli',
          ...(props.ignoreDependencies ?? []),
        ]),
      },
    };

    const config: StaticObject = {
      ignoreExportsUsedInFile: { interface: true, type: true },
      ...existing,
      workspaces: Object.fromEntries(
        Object.entries(workspaces).sort(([a], [b]) =>
          a === '.' ? -1 : b === '.' ? 1 : a.localeCompare(b),
        ),
      ),
    };

    // A kept config still needs the ignores for dependencies CTM adds that Knip can't see used.
    const missingIgnores = keepExisting
      ? ['@changesets/cli', ...(props.ignoreDependencies ?? [])].filter(
          (dependency) => !rootIgnores?.includes(dependency),
        )
      : [];

    return withoutAlternate(props.alternate, 'knip.config.ts', {
      suggestions: missingIgnores.length
        ? [
            `knip.config.ts has comments or code CTM can't rewrite, so it was left as it is. Add these to its workspaces['.'].ignoreDependencies, which Knip can't see used: ${missingIgnores.join(', ')}.`,
          ]
        : [],
      extensions: [
        blockGitHubActionsCI({
          jobs: [{ id: 'knip', name: 'Knip', steps: [{ run: 'pnpm knip' }] }],
        }),
        blockRootPackageJson({
          devDependencies: pinned('knip'),
        }),
      ],
      files: {
        'knip.config.ts':
          keepExisting && props.existing !== undefined
            ? props.existing
            : `import type { KnipConfig } from 'knip';

const config: KnipConfig = ${printStatic(config, readConfigLayout(props.existing))};

export default config;
`,
      },
    });
  },
});
