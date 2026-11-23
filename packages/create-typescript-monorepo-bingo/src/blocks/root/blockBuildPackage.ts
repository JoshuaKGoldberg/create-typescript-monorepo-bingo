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
  getRepositoryUrl,
  getTypeScript7Alias,
  usesTaskRunner,
} from '../../utils/options.ts';
import { pin } from '../../utils/pins.ts';
import { blockGitHubActionsCI } from './blockGitHubActionsCI.ts';
import { blockGitignore } from './blockGitignore.ts';
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
      }).filter(([, text]) => text !== undefined),
    );
    return { existing };
  },
  props: {
    existing: z
      .object({
        packageJson: z.string().optional(),
        readme: z.string().optional(),
        tsconfig: z.string().optional(),
        tsconfigBase: z.string().optional(),
        tsdownBase: z.string().optional(),
        tsdownIndex: z.string().optional(),
        rootTsdown: z.string().optional(),
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

    return {
      suggestions: [
        ...(ownsBase ? [] : [describeUnownedFile('packages/build/src/tsdown/base.ts')]),
        ...(workspaceReady
          ? []
          : [
              `tsdown's workspace mode skips package configs without an entry, so a root tsdown build wasn't added. Spread the build package's base, or add an entry, in: ${unready.map((pkg) => pkg.directory).join(', ')}.`,
            ]),
      ],
      extensions: [
        blockGitHubActionsCI({
          jobs: [
            { id: 'build', name: 'Build', steps: [{ run: 'pnpm build' }] },
            { id: 'type_check', name: 'Type Check', steps: [{ run: 'pnpm typecheck' }] },
          ],
        }),
        blockGitignore({ ignores: ['dist/', 'lib/'] }),
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
            [name]: 'workspace:^',
            tsdown: pin('tsdown'),
            typescript: typescriptSpecifier(),
            [typescript7Alias]: typescript7Specifier(),
          },
          scripts: {
            ...(!usesTaskRunner(options) && workspaceReady && { build: 'tsdown' }),
            typecheck: 'tsc -b',
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
              `# ${name}\n\nShared build configs for ${options.title}.\n\nThis package is private and generated by [create-typescript-monorepo-bingo](https://github.com/JoshuaKGoldberg/create-typescript-monorepo-bingo).\n`,
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
        ...(existingTexts.rootTsdown === undefined &&
          workspaceReady && { 'tsdown.config.ts': rootTsdownConfig }),
      },
    };
  },
});
