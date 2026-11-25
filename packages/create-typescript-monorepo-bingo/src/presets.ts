import { packageBase } from './bases/packageBase.ts';
import { rootBase } from './bases/rootBase.ts';
import { blockPackageJson } from './blocks/package/blockPackageJson.ts';
import { blockPackageStarter } from './blocks/package/blockPackageStarter.ts';
import { blockPackageTSConfig } from './blocks/package/blockPackageTSConfig.ts';
import { blockPackageTSDown } from './blocks/package/blockPackageTSDown.ts';
import { blockAllContributors } from './blocks/root/blockAllContributors.ts';
import { blockBuildPackage } from './blocks/root/blockBuildPackage.ts';
import { blockChangesets } from './blocks/root/blockChangesets.ts';
import { blockCSpell } from './blocks/root/blockCSpell.ts';
import { blockDocs } from './blocks/root/blockDocs.ts';
import { blockESLint } from './blocks/root/blockESLint.ts';
import { blockGitHooks } from './blocks/root/blockGitHooks.ts';
import { blockGitHubActionsCI } from './blocks/root/blockGitHubActionsCI.ts';
import { blockGitHubActionsSetup } from './blocks/root/blockGitHubActionsSetup.ts';
import { blockGitignore } from './blocks/root/blockGitignore.ts';
import { blockKnip } from './blocks/root/blockKnip.ts';
import { blockNvmrc } from './blocks/root/blockNvmrc.ts';
import { blockOctoGuide } from './blocks/root/blockOctoGuide.ts';
import { blockOxfmt } from './blocks/root/blockOxfmt.ts';
import { blockPnpmWorkspace } from './blocks/root/blockPnpmWorkspace.ts';
import { blockRenovate } from './blocks/root/blockRenovate.ts';
import { blockRepositoryLabels } from './blocks/root/blockRepositoryLabels.ts';
import { blockRepositoryRuleset } from './blocks/root/blockRepositoryRuleset.ts';
import { blockRepositorySettings } from './blocks/root/blockRepositorySettings.ts';
import { blockRootPackageJson } from './blocks/root/blockRootPackageJson.ts';
import { blockRootTSConfig } from './blocks/root/blockRootTSConfig.ts';
import { blockSite } from './blocks/root/blockSite.ts';
import { blockNx, blockPnpmTasks, blockTurborepo } from './blocks/root/blockTaskRunners.ts';
import { blockTransitions } from './blocks/root/blockTransitions.ts';
import { blockVitest } from './blocks/root/blockVitest.ts';
import { blockVSCode } from './blocks/root/blockVSCode.ts';

const rootBlocks = [
  blockAllContributors,
  blockBuildPackage,
  blockChangesets,
  blockCSpell,
  blockDocs,
  blockESLint,
  blockGitHooks,
  blockGitHubActionsCI,
  blockGitHubActionsSetup,
  blockGitignore,
  blockKnip,
  blockNvmrc,
  blockNx,
  blockOctoGuide,
  blockOxfmt,
  blockPnpmTasks,
  blockPnpmWorkspace,
  blockRenovate,
  blockRepositoryLabels,
  blockRepositoryRuleset,
  blockRepositorySettings,
  blockRootPackageJson,
  blockRootTSConfig,
  blockSite,
  blockTransitions,
  blockTurborepo,
  blockVitest,
  blockVSCode,
];

export const rootPreset = rootBase.createPreset({
  about: {
    name: 'Root',
  },
  blocks: rootBlocks,
});

export const packageBlocks = [
  blockPackageJson,
  blockPackageStarter,
  blockPackageTSConfig,
  blockPackageTSDown,
];

export const packagePreset = packageBase.createPreset({
  about: {
    name: 'Package',
  },
  blocks: packageBlocks,
});
