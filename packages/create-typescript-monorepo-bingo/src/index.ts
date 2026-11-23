export { packageBase } from './bases/packageBase.ts';
export { rootBase } from './bases/rootBase.ts';
export { blockPackageJson } from './blocks/package/blockPackageJson.ts';
export { blockPackageStarter } from './blocks/package/blockPackageStarter.ts';
export { blockPackageTSConfig } from './blocks/package/blockPackageTSConfig.ts';
export { blockPackageTSDown } from './blocks/package/blockPackageTSDown.ts';
export { blockAllContributors } from './blocks/root/blockAllContributors.ts';
export { blockBuildPackage } from './blocks/root/blockBuildPackage.ts';
export { blockChangesets } from './blocks/root/blockChangesets.ts';
export { blockCSpell } from './blocks/root/blockCSpell.ts';
export { blockDocs } from './blocks/root/blockDocs.ts';
export { blockESLint } from './blocks/root/blockESLint.ts';
export { blockGitHooks } from './blocks/root/blockGitHooks.ts';
export { blockGitHubActionsCI } from './blocks/root/blockGitHubActionsCI.ts';
export { blockGitHubActionsSetup } from './blocks/root/blockGitHubActionsSetup.ts';
export { blockGitignore } from './blocks/root/blockGitignore.ts';
export { blockKnip } from './blocks/root/blockKnip.ts';
export { blockNvmrc } from './blocks/root/blockNvmrc.ts';
export { blockOctoGuide } from './blocks/root/blockOctoGuide.ts';
export { blockOxfmt } from './blocks/root/blockOxfmt.ts';
export { blockPnpmWorkspace } from './blocks/root/blockPnpmWorkspace.ts';
export { blockRenovate } from './blocks/root/blockRenovate.ts';
export { blockRootPackageJson } from './blocks/root/blockRootPackageJson.ts';
export { blockRootTSConfig } from './blocks/root/blockRootTSConfig.ts';
export { blockSite } from './blocks/root/blockSite.ts';
export { blockNx, blockPnpmTasks, blockTurborepo } from './blocks/root/blockTaskRunners.ts';
export { blockVitest } from './blocks/root/blockVitest.ts';
export { blockVSCode } from './blocks/root/blockVSCode.ts';
export {
  type CatalogMode,
  type PackageKind,
  type PackageOptions,
  type PackageSpec,
  type RootOptions,
  type TaskRunner,
} from './options.ts';
export { packagePreset, rootPreset } from './presets.ts';
export { produceMonorepo } from './production/produceMonorepo.ts';
export { template } from './template.ts';
export { isProtocolSpecifier, parseNpmAlias, resolveSpecifier } from './utils/versions.ts';
