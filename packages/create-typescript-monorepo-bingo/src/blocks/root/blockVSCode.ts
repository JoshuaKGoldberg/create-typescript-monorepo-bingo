import { z } from 'zod';

import { rootBase } from '../../bases/rootBase.ts';
import { parseJsonText, readText } from '../../utils/files.ts';
import { formatJson, sortKeys } from '../../utils/json.ts';
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
  produce({ props }) {
    const texts = props.existing ?? {};
    const existingExtensions = parseJsonText(texts.extensions).recommendations as
      | string[]
      | undefined;
    const extensions = mergeList(existingExtensions, props.extensions ?? []);
    const settings = sortKeys({
      'editor.formatOnSave': true,
      'editor.rulers': [100],
      ...props.settings,
      ...parseJsonText(texts.settings),
    });
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
