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
import { emitsFiles } from '../../utils/tsconfig.ts';
import { getMinimumVersion } from '../../utils/versions.ts';
import { blockGitHubActionsCI } from './blockGitHubActionsCI.ts';
import { blockGitignore } from './blockGitignore.ts';
import { blockKnip } from './blockKnip.ts';
import { blockPnpmWorkspace } from './blockPnpmWorkspace.ts';
import { blockRootPackageJson } from './blockRootPackageJson.ts';
import { blockRootTSConfig } from './blockRootTSConfig.ts';
import { blockVSCode } from './blockVSCode.ts';

/**
 * The `typescript` alias only ships a `tsc6` binary, so `tsc` comes from the TypeScript 7 alias.
 */
const typescriptSpecifier = (): string => pin('typescript');

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
  clean: ['./dist/', './node_modules/.cache/tsbuild/'],
  // Building referenced packages first keeps their types from being \`any\`
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

export const blockBuildPackage = rootBase.createBlock({
  about: {
    name: 'Build Package',
  },
  intake({ files, options }) {
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
    const workspaceText = readText(files, 'pnpm-workspace.yaml');
    const typecheckName = ['typecheck', 'tsc'].find(
      (name) => rootScripts[name] !== undefined && runsTsc(rootScripts[name]),
    );
    const rootTSConfig = parseJsonText(readText(files, 'tsconfig.json'));
    // Plain tsc commands fail once there are project references to build
    const addsReferences =
      !options.rootTSConfigExtended &&
      readText(files, 'tsconfig.json') !== undefined &&
      rootTSConfig.references === undefined &&
      (readText(files, 'packages/build/package.json') === undefined || !!options.newPackage);
    const emits = emitsFiles(
      rootTSConfig.compilerOptions,
      Object.values(rootScripts).filter((script) => script !== undefined),
    );
    const buildScripts = Object.entries(rootScripts).map(
      ([name, script = '']) =>
        [
          name,
          // Other directories' tsconfigs may emit
          addsReferences && !emits && !/\bcd\s/.test(script)
            ? script.replaceAll(/(^|&&\s*|;\s*)tsc(?: --noEmit)?(?=\s*(?:$|&&|;))/g, '$1tsc -b')
            : script,
        ] as const,
    );
    const replacedScripts = Object.fromEntries(
      buildScripts.filter(([name, script]) => script !== rootScripts[name]),
    );
    const typecheck =
      typecheckName && (replacedScripts[typecheckName] ?? rootScripts[typecheckName]);
    const plainTscScripts = addsReferences
      ? buildScripts
          .filter(([, script]) => runsPlainTsc(script, rootScripts.tsc !== undefined))
          .map(([name]) => name)
      : [];
    const rootTypeScript = [rootManifest.devDependencies, rootManifest.dependencies]
      .map((dependencies) => (dependencies as Record<string, string> | undefined)?.typescript)
      .find((specifier) => specifier !== undefined);
    return {
      existing,
      // Knip only sees the TypeScript 7 alias as used if a root script runs tsc
      ...(Object.values(rootScripts).some((script) => script && runsTsc(script)) && {
        rootRunsTsc: true,
      }),
      ...((rootScripts.typecheck !== undefined || typecheckName) && { rootHasTypecheck: true }),
      // Existing typecheck scripts may need steps that CTM's job doesn't have
      ...((typecheck ?? rootScripts.typecheck ?? 'tsc -b') !== 'tsc -b' && { ownTypecheck: true }),
      ...(typecheckName === 'tsc' && { typecheckName }),
      ...(Object.keys(replacedScripts).length && { replacedScripts }),
      ...(plainTscScripts.length && { plainTscScripts }),
      ...(rootTypeScript && {
        rootTypeScript,
        rootTypeScriptMajor: getMinimumVersion('typescript', rootTypeScript, workspaceText)?.major,
      }),
      ...(rootBuild !== undefined && { rootBuild }),
      ...(rootTsdownSpecifier && { rootTsdownSpecifier }),
      ...(rootTsdownSpecifier && {
        rootTsdownMinimum: getMinimumVersion('tsdown', rootTsdownSpecifier, workspaceText)?.version,
      }),
      olderLibraryTsdown: (options.packages ?? [])
        .filter((pkg) => {
          const minimum =
            pkg.kind === 'library'
              ? getMinimumVersion('tsdown', pkg.toolDevDependencies?.tsdown, workspaceText)
              : undefined;
          return !!minimum && semver.lt(minimum, pin('tsdown'));
        })
        .map((pkg) => pkg.directory),
    };
  },
  props: {
    rootBuild: z.string().optional(),
    ownTypecheck: z.boolean().optional(),
    rootHasTypecheck: z.boolean().optional(),
    plainTscScripts: z.array(z.string()).optional(),
    replacedScripts: z.record(z.string(), z.string()).optional(),
    rootRunsTsc: z.boolean().optional(),
    rootTypeScript: z.string().optional(),
    rootTypeScriptMajor: z.number().optional(),
    olderLibraryTsdown: z.array(z.string()).optional(),
    rootTsdownMinimum: z.string().optional(),
    rootTsdownSpecifier: z.string().optional(),
    typecheckName: z.string().optional(),
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
    if (
      props.existing?.packageJson === undefined &&
      !(options.packages ?? []).some((pkg) => pkg.kind === 'library')
    ) {
      return {};
    }

    const keptTypeScript = `TypeScript${props.rootTypeScript ? ` ${props.rootTypeScript}` : ''} was kept because it's older than 6 or a tsconfig.json uses ignoreDeprecations. Update those and re-run to switch to TypeScript 7.`;
    if (options.buildPackageSkipped) {
      return { suggestions: [keptTypeScript] };
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
    const olderLibraryTsdown = props.olderLibraryTsdown ?? [];
    // A root tsdown config only helps when the root build runs tsdown
    const writesRootTsdown =
      existingTexts.rootTsdown === undefined &&
      workspaceReady &&
      !usesTaskRunner(options) &&
      (props.rootBuild === undefined || /\btsdown\b/.test(props.rootBuild));
    // If libraries declare their own tsdown, the root's tools are only used indirectly
    const libraries = (options.packages ?? []).filter((pkg) => pkg.kind === 'library');
    const rootToolsIndirect =
      existingTexts.rootTsdown === undefined &&
      !writesRootTsdown &&
      libraries.filter((pkg) => pkg.toolDevDependencies?.tsdown).length * 2 > libraries.length;
    const rootUsesBuildPackage =
      existingTexts.rootTSConfig === undefined ||
      [existingTexts.rootTSConfig, existingTexts.rootTsdown].some((text) =>
        text?.includes(`${name}/`),
      );
    const { catalogEntries, dependencies } = resolveDependencies(
      options,
      'dependencies',
      existing.dependencies as Dependencies | undefined,
      ownsBase
        ? {
            tsdown: pin('tsdown'),
            typescript: options.typescriptKept
              ? (props.rootTypeScript ?? typescriptSpecifier())
              : typescriptSpecifier(),
          }
        : {},
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
    // The TypeScript 7 alias would replace an older TypeScript's tsc bin
    const addsTypeScript7 = !options.typescriptKept;
    const typescript7Unseen =
      addsTypeScript7 &&
      !props.rootRunsTsc &&
      (!!props.rootHasTypecheck || !!options.rootTSConfigExtended);

    return {
      suggestions: [
        ...(ownsBase ? [] : [describeUnownedFile('packages/build/src/tsdown/base.ts')]),
        ...(options.typescriptKept ? [keptTypeScript] : []),
        ...(props.plainTscScripts
          ? [
              `These root scripts' tsc commands don't build project references: ${props.plainTscScripts.join(', ')}. Change them to use \`tsc -b\`.`,
            ]
          : []),
        ...(props.rootTypeScriptMajor === 7
          ? [
              `TypeScript ${props.rootTypeScript ?? '7'} doesn't include the JavaScript API that tools such as typescript-eslint use. Change typescript to ${typescriptSpecifier()}.`,
            ]
          : []),
        // The build package's base is typed for CTM's tsdown version
        ...(props.rootTsdownMinimum && semver.lt(props.rootTsdownMinimum, pin('tsdown'))
          ? [
              `The root's tsdown ${props.rootTsdownSpecifier ?? props.rootTsdownMinimum} is older than the build package needs. Update it to ^${pin('tsdown')}.`,
            ]
          : []),
        // A root build that doesn't run tsdown or packages' builds would skip CTM's packages
        ...(props.rootBuild !== undefined &&
        !writesRootTsdown &&
        !usesTaskRunner(options) &&
        !/\btsdown\b|\b(?:turbo|nx|lerna)\b|--recursive|--filter|(?:^|\s)-[rF]\b/.test(
          props.rootBuild,
        )
          ? [
              `The root build script, \`${props.rootBuild}\`, doesn't build packages that use tsdown. Add \`pnpm --recursive run build\` to it, or run tsdown with the build package's base.`,
            ]
          : []),
        ...(olderLibraryTsdown.length
          ? [
              `These packages' tsdown versions are older than the build package needs: ${olderLibraryTsdown.join(', ')}. Update them to ^${pin('tsdown')}.`,
            ]
          : []),
        ...(workspaceReady
          ? []
          : [
              `Packages are built with their own scripts because these don't have an entry in their tsdown config: ${unready.map((pkg) => pkg.directory).join(', ')}. Add an entry or the build package's base to each to build them all with the root tsdown.`,
            ]),
      ],
      extensions: [
        blockGitHubActionsCI({
          jobs: [
            { id: 'build', name: 'Build', steps: [{ run: 'pnpm build' }] },
            ...(options.rootTSConfigExtended || props.ownTypecheck
              ? []
              : [
                  {
                    id: 'type_check',
                    name: 'Type Check',
                    steps: [{ run: `pnpm ${props.typecheckName ?? 'typecheck'}` }],
                  },
                ]),
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
          // The TypeScript 6 alias has no tsserver.js, so editors need the package it wraps
          ...(addsTypeScript7 && { settings: { publicHoistPattern: ['@typescript/old'] } }),
        }),
        ...(addsTypeScript7
          ? [blockVSCode({ settings: { 'js/ts.tsdk.path': 'node_modules/@typescript/old/lib' } })]
          : []),
        blockRootPackageJson({
          devDependencies: {
            ...(ownsBase && {
              '@arethetypeswrong/core': pin('@arethetypeswrong/core'),
              publint: pin('publint'),
            }),
            '@types/node': pin('@types/node'),
            ...(rootUsesBuildPackage && { [name]: 'workspace:^' }),
            tsdown: pin('tsdown'),
            ...(!options.typescriptKept && { typescript: typescriptSpecifier() }),
            ...(addsTypeScript7 && { [typescript7Alias]: typescript7Specifier() }),
          },
          scripts: {
            // tsdown's workspace mode may skip some packages
            ...(!usesTaskRunner(options) && {
              build: workspaceReady
                ? 'tsdown'
                : `pnpm --recursive ${getPackageFilters(options)} run build`,
            }),
            ...(!options.rootTSConfigExtended && !props.typecheckName && { typecheck: 'tsc -b' }),
          },
          ...(!options.rootTSConfigExtended &&
            props.replacedScripts && { replaced: { scripts: props.replacedScripts } }),
        }),
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
        ...(writesRootTsdown && { 'tsdown.config.ts': rootTsdownConfig }),
      },
    };
  },
});

function runsTsc(script: string) {
  return /(?:^|[\s;&|(])tsc(?:\s|$)/.test(script);
}

function runsPlainTsc(script: string, hasTscScript: boolean) {
  return (
    script
      // Other directories' tsconfigs don't receive references
      .replace(/\bcd\s.*$/s, '')
      .split(/&&|\|\||[;|]/)
      .map((command) =>
        command
          .trim()
          .replace(hasTscScript ? /^(?:npx|pnpm exec) / : /^(?:npx|pnpm(?: exec)?) /, ''),
      )
      .some(
        (command) =>
          /^tsc(?:\s|$)/.test(command) &&
          !/\s(?:-b|--build|-v|--version)\b/.test(command) &&
          // Other projects don't receive references
          !/\s(?:-p|--project)\s+(?!(?:\.\/)?tsconfig\.json|\.(?:\s|$))/.test(command),
      )
  );
}
