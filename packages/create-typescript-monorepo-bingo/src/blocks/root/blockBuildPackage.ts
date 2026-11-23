import semver from 'semver';
import { z } from 'zod';

import { rootBase } from '../../bases/rootBase.ts';
import { type Dependencies, resolveDependencies } from '../../utils/catalogs.ts';
import {
  describeUnownedFile,
  isOwnedFile,
  ownedFileMarker,
  parseJsonText,
  readText,
} from '../../utils/files.ts';
import { formatJson, formatPackageJson, sortKeys, withDefaults } from '../../utils/json.ts';
import {
  getBuildPackageName,
  getPackageFilters,
  getRepositoryUrl,
  getTypeScript7Alias,
  usesTaskRunner,
} from '../../utils/options.ts';
import { pin } from '../../utils/pins.ts';
import { blockGitHubActionsCI } from './blockGitHubActionsCI.ts';
import { blockGitignore } from './blockGitignore.ts';
import { blockKnip } from './blockKnip.ts';
import { blockPnpmWorkspace } from './blockPnpmWorkspace.ts';
import { blockRootPackageJson } from './blockRootPackageJson.ts';
import { blockRootTSConfig } from './blockRootTSConfig.ts';
import { blockVSCode } from './blockVSCode.ts';

/**
 * TypeScript's API, for typescript-eslint, tsdown's `tsc` declarations and `astro check`.
 * The wrapper only ships a `tsc6` binary, so `tsc` comes from the TypeScript 7 alias.
 */
const typescriptSpecifier = (): string => pin('typescript');

/**
 * TypeScript 7, for the `tsc` binary.
 */
const typescript7Specifier = (): string => pin('typescript7');

const tsconfigBase = {
  compilerOptions: {
    allowImportingTsExtensions: true,
    allowUnreachableCode: false,
    composite: true,
    declaration: true,
    emitDeclarationOnly: true,
    erasableSyntaxOnly: true,
    esModuleInterop: true,
    module: 'NodeNext',
    moduleResolution: 'NodeNext',
    noErrorTruncation: true,
    noImplicitOverride: true,
    resolveJsonModule: true,
    skipLibCheck: true,
    strict: true,
    target: 'ES2022',
  },
};

const tsdownBase = `${ownedFileMarker}

import type { UserConfig } from 'tsdown';

export const base: UserConfig = {
  attw: {
    enabled: 'ci-only',
    profile: 'esm-only',
  },
  clean: ['./node_modules/.cache/tsbuild/'],
  // tsc in build mode builds referenced packages first, so declarations never see a
  // sibling's types as \`any\` before it's built. Packages with isolatedDeclarations use oxc.
  dts: { tsc: { build: true, incremental: true } },
  entry: ['src/index.ts'],
  exports: {
    devExports: true,
  },
  publint: 'ci-only',
};
`;

const rootTsdownConfig = `import { defineConfig, type UserConfig } from 'tsdown';

const config: UserConfig = defineConfig({
  workspace: true,
});

export default config;
`;

/**
 * Owns the private `@&lt;scope>/build` package, with the shared tsconfig and tsdown base,
 * as well as the root tsdown config and the TypeScript dependencies.
 */
export const blockBuildPackage = rootBase.createBlock({
  about: {
    name: 'Build Package',
  },
  intake({ files }) {
    const existing = Object.fromEntries(
      Object.entries({
        packageJson: readText(files, 'packages/build/package.json'),
        readme: readText(files, 'packages/build/README.md'),
        tsconfig: readText(files, 'packages/build/tsconfig.json'),
        tsconfigBase: readText(files, 'packages/build/tsconfig.base.json'),
        tsdownBase: readText(files, 'packages/build/src/tsdown/base.ts'),
        tsdownIndex: readText(files, 'packages/build/src/tsdown/index.ts'),
        rootTsdown: readText(files, 'tsdown.config.ts'),
        rootTSConfig: readText(files, 'tsconfig.json'),
      }).filter(([, text]) => text !== undefined),
    );
    const rootManifest = parseJsonText(readText(files, 'package.json'));
    const rootTsdownSpecifier = [rootManifest.devDependencies, rootManifest.dependencies]
      .map((dependencies) => (dependencies as Record<string, string> | undefined)?.tsdown)
      .find((specifier) => specifier !== undefined);
    const rootScripts = (rootManifest.scripts ?? {}) as Partial<Record<string, string>>;
    const rootBuild = rootScripts.build;
    const rootTypeScript = [rootManifest.devDependencies, rootManifest.dependencies]
      .map((dependencies) => (dependencies as Record<string, string> | undefined)?.typescript)
      .find((specifier) => specifier !== undefined);
    return {
      existing,
      // Knip counts the TypeScript 7 alias as used through a root script that runs tsc,
      // like CTM's typecheck, which a repository's own typecheck script replaces.
      ...(Object.values(rootScripts).some(
        (script) => script && /(?:^|[\s;&|(])tsc(?:\s|$)/.test(script),
      ) && { rootRunsTsc: true }),
      ...(rootScripts.typecheck !== undefined && { rootHasTypecheck: true }),
      ...(rootTypeScript && { rootTypeScript }),
      ...(rootBuild !== undefined && { rootBuild }),
      ...(rootTsdownSpecifier && { rootTsdownSpecifier }),
    };
  },
  props: {
    rootBuild: z.string().optional(),
    rootHasTypecheck: z.boolean().optional(),
    rootRunsTsc: z.boolean().optional(),
    rootTypeScript: z.string().optional(),
    rootTsdownSpecifier: z.string().optional(),
    existing: z
      .object({
        packageJson: z.string().optional(),
        readme: z.string().optional(),
        tsconfig: z.string().optional(),
        tsconfigBase: z.string().optional(),
        tsdownBase: z.string().optional(),
        tsdownIndex: z.string().optional(),
        rootTsdown: z.string().optional(),
        rootTSConfig: z.string().optional(),
      })
      .optional(),
  },
  produce({ options, props }) {
    // A repository with no tsdown-built packages has its own build: nothing here applies.
    if (
      props.existing?.packageJson === undefined &&
      !(options.packages ?? []).some((pkg) => pkg.kind === 'library')
    ) {
      return {};
    }

    const existingTexts = props.existing ?? {};
    const existing = parseJsonText(existingTexts.packageJson);
    const existingTSConfig = parseJsonText(existingTexts.tsconfig);
    const existingTSConfigBase = parseJsonText(existingTexts.tsconfigBase);
    const name = getBuildPackageName(options);
    const ownsBase = isOwnedFile(existingTexts.tsdownBase);
    const unready = (options.packages ?? []).filter(
      (pkg) => pkg.kind === 'library' && pkg.tsdownWorkspaceReady === false,
    );
    const workspaceReady = !unready.length;
    const olderLibraryTsdown = (options.packages ?? [])
      .filter((pkg) => {
        const specifier = pkg.kind === 'library' ? pkg.toolDevDependencies?.tsdown : undefined;
        const minimum =
          specifier && semver.validRange(specifier) ? semver.minVersion(specifier) : undefined;
        return !!minimum && semver.lt(minimum, pin('tsdown'));
      })
      .map((pkg) => pkg.directory);
    // A root tsdown config only helps when the root build runs tsdown: an existing build,
    // like nx run-many, or a task runner's, builds packages with their own configs.
    const writesRootTsdown =
      existingTexts.rootTsdown === undefined &&
      workspaceReady &&
      !usesTaskRunner(options) &&
      (props.rootBuild === undefined || /\btsdown\b/.test(props.rootBuild));
    // Libraries that mostly declare their own tsdown, as new ones then do too, build with it
    // when the root doesn't run tsdown: the root's tsdown, and the attw and publint that
    // packages' tsdown finds from the root, are then only used indirectly.
    const libraries = (options.packages ?? []).filter((pkg) => pkg.kind === 'library');
    const rootToolsIndirect =
      existingTexts.rootTsdown === undefined &&
      !writesRootTsdown &&
      libraries.filter((pkg) => pkg.toolDevDependencies?.tsdown).length * 2 > libraries.length;
    // The root depends on the build package only when something there uses it.
    const rootUsesBuildPackage =
      existingTexts.rootTSConfig === undefined ||
      [existingTexts.rootTSConfig, existingTexts.rootTsdown].some((text) =>
        text?.includes(`${name}/`),
      );
    const { catalogEntries, dependencies } = resolveDependencies(
      options,
      'dependencies',
      existing.dependencies as Dependencies | undefined,
      // A tsdown base the repository owns decides its own dependencies.
      ownsBase ? { tsdown: pin('tsdown'), typescript: typescriptSpecifier() } : {},
      'devDependencies',
    );

    const packageJson = {
      ...(existingTexts.packageJson === undefined
        ? {
            name,
            version: '0.1.0',
            description: `Shared build configs for ${options.title}`,
            repository: {
              type: 'git',
              url: getRepositoryUrl(options),
              directory: 'packages/build',
            },
            license: 'MIT',
          }
        : existing),
      name,
      private: true,
      type: 'module',
      exports: {
        ...(existing.exports as object | undefined),
        './package.json': './package.json',
        './tsconfig.base.json': './tsconfig.base.json',
        './tsdown': './src/tsdown/index.ts',
      },
      dependencies: sortKeys(dependencies),
    };

    const typescript7Alias = getTypeScript7Alias(options);
    // TypeScript 7's alias would take over the tsc bin from a root TypeScript older than 6,
    // which, unlike TypeScript 6's, ships its own.
    const rootTypeScriptMinimum =
      props.rootTypeScript && semver.validRange(props.rootTypeScript)
        ? semver.minVersion(props.rootTypeScript)
        : undefined;
    const addsTypeScript7 = !rootTypeScriptMinimum || rootTypeScriptMinimum.major >= 6;
    // Knip only sees the alias used through a root script that runs tsc.
    const typescript7Unseen =
      addsTypeScript7 &&
      !props.rootRunsTsc &&
      (!!props.rootHasTypecheck || !!options.rootTSConfigExtended);

    return {
      suggestions: [
        ...(ownsBase ? [] : [describeUnownedFile('packages/build/src/tsdown/base.ts')]),
        ...(addsTypeScript7
          ? []
          : [
              `The root's TypeScript ${props.rootTypeScript ?? ''} is older than 6, so CTM didn't add TypeScript 7 as ${typescript7Alias}, whose tsc would replace it. Update to TypeScript 6 and re-run to type check with both.`,
            ]),
        // An existing tsdown is kept, but packages' configs spread a base typed for CTM's.
        ...(props.rootTsdownSpecifier &&
        semver.validRange(props.rootTsdownSpecifier) &&
        semver.lt(semver.minVersion(props.rootTsdownSpecifier) ?? pin('tsdown'), pin('tsdown'))
          ? [
              `The root's tsdown ${props.rootTsdownSpecifier} allows versions older than the ${pin('tsdown')} the build package's tsdown base is written for. Update it to ^${pin('tsdown')}, so packages build and typecheck with one tsdown.`,
            ]
          : []),
        ...(olderLibraryTsdown.length
          ? [
              `These packages declare a tsdown older than the ${pin('tsdown')} the build package's tsdown base is written for: ${olderLibraryTsdown.join(', ')}. Update them to ^${pin('tsdown')}.`,
            ]
          : []),
        ...(workspaceReady
          ? []
          : [
              `tsdown's workspace mode skips package configs without an entry, so packages build with their own scripts instead. To build them all with one root tsdown, spread the build package's base, or add an entry, in: ${unready.map((pkg) => pkg.directory).join(', ')}.`,
            ]),
      ],
      extensions: [
        blockGitHubActionsCI({
          jobs: [
            { id: 'build', name: 'Build', steps: [{ run: 'pnpm build' }] },
            // A root tsconfig.json that packages extend isn't one tsc -b can check from.
            ...(options.rootTSConfigExtended
              ? []
              : [{ id: 'type_check', name: 'Type Check', steps: [{ run: 'pnpm typecheck' }] }]),
          ],
        }),
        blockGitignore({ ignores: ['dist/', 'lib/'] }),
        ...(rootToolsIndirect || typescript7Unseen
          ? [
              blockKnip({
                ignoreDependencies: [
                  ...(rootToolsIndirect
                    ? [...(ownsBase ? ['@arethetypeswrong/core', 'publint'] : []), 'tsdown']
                    : []),
                  ...(typescript7Unseen ? [typescript7Alias] : []),
                ],
              }),
            ]
          : []),
        blockPnpmWorkspace({
          catalogEntries,
          packages: ['packages/build'],
          // The typescript alias's own lib/ has no tsserver.js, so editors get TypeScript 6
          // from the real compiler package it wraps, hoisted to a stable path.
          settings: { publicHoistPattern: ['@typescript/old'] },
        }),
        blockVSCode({ settings: { 'js/ts.tsdk.path': 'node_modules/@typescript/old/lib' } }),
        blockRootPackageJson({
          devDependencies: {
            // CTM's tsdown base runs attw and publint.
            ...(ownsBase && {
              '@arethetypeswrong/core': pin('@arethetypeswrong/core'),
              publint: pin('publint'),
            }),
            '@types/node': pin('@types/node'),
            ...(rootUsesBuildPackage && { [name]: 'workspace:^' }),
            tsdown: pin('tsdown'),
            typescript: typescriptSpecifier(),
            ...(addsTypeScript7 && { [typescript7Alias]: typescript7Specifier() }),
          },
          scripts: {
            // Without a task runner, a package tsdown's workspace mode would skip is built
            // by running every package's own build.
            ...(!usesTaskRunner(options) && {
              build: workspaceReady
                ? 'tsdown'
                : `pnpm --recursive ${getPackageFilters(options)} run build`,
            }),
            ...(!options.rootTSConfigExtended && { typecheck: 'tsc -b' }),
          },
        }),
        // Existing repositories keep their own choice of whether to reference the build package.
        ...(existingTexts.packageJson === undefined
          ? [blockRootTSConfig({ references: ['packages/build'] })]
          : []),
      ],
      files: {
        packages: {
          build: {
            'package.json': formatPackageJson(packageJson, existingTexts.packageJson),
            'README.md':
              existingTexts.readme ??
              `# ${name}\n\nShared build configs for ${options.title}.\n\nThis package is private and generated by [\`create-typescript-monorepo-bingo\`](https://github.com/JoshuaKGoldberg/create-typescript-monorepo-bingo).\n`,
            src: {
              tsdown: {
                ...(isOwnedFile(existingTexts.tsdownBase) && { 'base.ts': tsdownBase }),
                ...(existingTexts.tsdownIndex === undefined && {
                  'index.ts': `export { base } from './base.ts';\n`,
                }),
              },
            },
            'tsconfig.base.json': formatJson(
              {
                ...existingTSConfigBase,
                // Existing compiler options are the repository's; CTM adds any that are missing.
                compilerOptions: withDefaults(
                  existingTSConfigBase.compilerOptions as Record<string, unknown> | undefined,
                  tsconfigBase.compilerOptions,
                ),
              },
              existingTexts.tsconfigBase,
            ),
            'tsconfig.json': formatJson(
              {
                extends: './tsconfig.base.json',
                ...existingTSConfig,
                compilerOptions: withDefaults(
                  existingTSConfig.compilerOptions as Record<string, unknown> | undefined,
                  {
                    outDir: 'lib/',
                    rootDir: 'src/',
                    tsBuildInfoFile: 'node_modules/.cache/tsbuild/info.src.json',
                    types: ['node'],
                  },
                ),
                include: existingTSConfig.include ?? ['src'],
              },
              existingTexts.tsconfig,
            ),
          },
        },
        // An existing root config is the repository's, like each package's own.
        ...(writesRootTsdown && { 'tsdown.config.ts': rootTsdownConfig }),
      },
    };
  },
});
