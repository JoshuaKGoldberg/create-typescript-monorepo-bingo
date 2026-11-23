import { z } from 'zod';

import { rootBase } from '../../bases/rootBase.ts';
import { readText } from '../../utils/files.ts';
import { mergeList } from '../../utils/lists.ts';
import { pinned } from '../../utils/pins.ts';
import {
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
    const existing = readText(files, 'knip.config.ts');
    return existing === undefined ? undefined : { existing };
  },
  props: {
    existing: z.string().optional(),
    ignoreDependencies: z.array(z.string()).optional(),
    workspaces: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  },
  produce({ props }) {
    const existing = readConfigObject(props.existing) ?? {};
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

    return {
      extensions: [
        blockGitHubActionsCI({
          jobs: [{ id: 'knip', name: 'Knip', steps: [{ run: 'pnpm knip' }] }],
        }),
        blockRootPackageJson({
          devDependencies: pinned('knip'),
        }),
      ],
      files: {
        'knip.config.ts': `import type { KnipConfig } from 'knip';

const config: KnipConfig = ${printStatic(config, readConfigLayout(props.existing))};

export default config;
`,
      },
    };
  },
});
