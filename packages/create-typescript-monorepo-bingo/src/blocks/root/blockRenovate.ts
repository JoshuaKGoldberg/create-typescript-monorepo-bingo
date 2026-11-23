import { z } from 'zod';

import { rootBase } from '../../bases/rootBase.ts';
import {
  findAlternateConfig,
  parseJsonText,
  readText,
  withoutAlternate,
} from '../../utils/files.ts';
import { formatJson, withDefaults } from '../../utils/json.ts';

const rangeStrategiesByCatalog: Record<string, string> = {
  dev: 'pin',
  peer: 'widen',
  prod: 'replace',
};

interface PackageRule {
  matchDepTypes?: string[];
}

/**
 * Owns `.github/renovate.json`: automerge, a 7-day minimum release age, `pnpm dedupe`,
 * and, with named catalogs, a range strategy per catalog. Existing settings are kept.
 */
export const blockRenovate = rootBase.createBlock({
  about: {
    name: 'Renovate',
  },
  intake({ files }) {
    const alternate = findAlternateConfig(files, 'renovate');
    const fromFiles = ((): object | undefined => {
      const existing = readText(files, '.github/renovate.json');
      return existing === undefined ? undefined : { existing };
    })();
    return alternate ? { ...fromFiles, alternate } : fromFiles;
  },
  props: {
    alternate: z.string().optional(),
    existing: z.string().optional(),
  },
  produce({ options, props }) {
    const existing = parseJsonText(props.existing);
    const existingRules = (existing.packageRules as PackageRule[] | undefined) ?? [];
    const packageRules = [...existingRules];

    if (options.catalogs === 'named') {
      for (const [catalog, rangeStrategy] of Object.entries(rangeStrategiesByCatalog)) {
        const depType = `pnpm.catalog.${catalog}`;
        if (!existingRules.some((rule) => rule.matchDepTypes?.includes(depType))) {
          packageRules.push({ matchDepTypes: [depType], rangeStrategy } as PackageRule);
        }
      }
    }

    return withoutAlternate(props.alternate, '.github/renovate.json', {
      files: {
        '.github': {
          'renovate.json': formatJson(
            {
              ...withDefaults(props.existing === undefined ? undefined : existing, {
                $schema: 'https://docs.renovatebot.com/renovate-schema.json',
                automerge: true,
                extends: [':preserveSemverRanges', 'config:best-practices', 'replacements:all'],
                labels: ['dependencies'],
                minimumReleaseAge: '7 days',
                postUpdateOptions: ['pnpmDedupe'],
              }),
              ...(packageRules.length && { packageRules }),
            },
            props.existing,
          ),
        },
      },
    });
  },
});
