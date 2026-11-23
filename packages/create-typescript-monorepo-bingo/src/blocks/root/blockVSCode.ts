import { z } from 'zod';

import { rootBase } from '../../bases/rootBase.ts';
import { parseJsonText, readText } from '../../utils/files.ts';
import { formatJson, sortKeys, withDefaults } from '../../utils/json.ts';
import { mergeList } from '../../utils/lists.ts';

/**
 * Owns `.vscode/`: recommended extensions, settings, and debug launch configurations.
 * Existing settings and recommendations are kept.
 */
export const blockVSCode = rootBase.createBlock({
  about: {
    name: 'VS Code',
  },
  intake({ files }) {
    return {
      existing: Object.fromEntries(
        ['extensions', 'launch', 'settings', 'tasks']
          .map((name) => [name, readText(files, `.vscode/${name}.json`)])
          .filter(([, text]) => text !== undefined),
      ) as Record<string, string>,
    };
  },
  props: {
    existing: z
      .object({
        extensions: z.string().optional(),
        launch: z.string().optional(),
        settings: z.string().optional(),
        tasks: z.string().optional(),
      })
      .optional(),
    extensions: z.array(z.string()).optional(),
    launch: z.record(z.string(), z.unknown()).optional(),
    settings: z.record(z.string(), z.unknown()).optional(),
  },
  produce({ options, props }) {
    const texts = props.existing ?? {};
    const existingExtensions = parseJsonText(texts.extensions).recommendations as
      | string[]
      | undefined;
    const extensions = mergeList(existingExtensions, props.extensions ?? []);
    const existingSettings = parseJsonText(texts.settings);
    // A new file's settings are sorted; an existing one keeps its keys in place,
    // with any it's missing appended.
    const ours = {
      // Without a formatter, VS Code's built-in one would restyle files.
      ...(options.formatter !== 'none' && { 'editor.formatOnSave': true }),
      'editor.rulers': [100],
      ...props.settings,
    };
    const settings = {
      ...(texts.settings === undefined ? sortKeys(ours) : withDefaults(existingSettings, ours)),
      ...updateStockTsdk(existingSettings, props.settings?.['js/ts.tsdk.path']),
    };
    const launch = texts.launch === undefined ? props.launch : parseJsonText(texts.launch);

    return {
      files: {
        '.vscode': {
          'extensions.json': formatJson(
            { ...parseJsonText(texts.extensions), recommendations: extensions },
            texts.extensions,
          ),
          ...(launch && { 'launch.json': formatJson(launch, texts.launch) }),
          'settings.json': formatJson(settings, texts.settings),
          'tasks.json': formatJson(
            texts.tasks === undefined
              ? {
                  tasks: [
                    {
                      detail: 'Build the project',
                      label: 'build',
                      script: 'build',
                      type: 'npm',
                    },
                  ],
                  version: '2.0.0',
                }
              : parseJsonText(texts.tasks),
            texts.tasks,
          ),
        },
      },
    };
  },
});

const stockTsdk = 'node_modules/typescript/lib';

/**
 * The typescript alias's own lib/ has no tsserver.js, so tsdk settings pointing at the stock
 * node_modules/typescript/lib are moved to CTM's path. Any other tsdk value is kept.
 */
function updateStockTsdk(existing: Record<string, unknown>, ours: unknown) {
  if (typeof ours !== 'string') {
    return {};
  }

  const stock = Object.keys(existing).filter(
    (key) =>
      (key === 'js/ts.tsdk.path' || key === 'typescript.tsdk') &&
      typeof existing[key] === 'string' &&
      existing[key].replace(/^\.\//, '').replace(/\/$/, '') === stockTsdk,
  );
  return Object.fromEntries(stock.map((key) => [key, ours]));
}
