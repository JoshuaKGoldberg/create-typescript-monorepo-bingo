import { z } from 'zod';

/**
 * - `library`: built with tsdown, and managed by CTM
 * - `bin-js`: a JavaScript-only bin, and left alone
 * - `build`: the shared build package
 * - `site`: a docs site
 * - `repo-owned`: anything else, and left alone
 */
export const packageKinds = ['library', 'bin-js', 'build', 'site', 'repo-owned'] as const;

export type PackageKind = (typeof packageKinds)[number];

export const packageSpecSchema = z.object({
  description: z.string().optional(),
  directory: z.string(),
  homepage: z.string().optional(),
  isolatedDeclarations: z.boolean().optional(),
  kind: z.enum(packageKinds),
  name: z.string(),
  nxTargets: z.array(z.string()).optional(),
  scripts: z.array(z.string()).optional(),
  toolDevDependencies: z.record(z.string(), z.string()).optional(),
  tsdownWorkspaceReady: z.boolean().optional(),
  extendsBuildTSConfig: z.boolean().optional(),
  usesBuildPackage: z.boolean().optional(),
  workspaceDependencies: z.array(z.string()).optional(),
});

export type PackageSpec = z.infer<typeof packageSpecSchema>;

export const catalogModes = ['none', 'default', 'named'] as const;

export type CatalogMode = (typeof catalogModes)[number];

export const taskRunners = ['none', 'pnpm', 'turbo', 'nx'] as const;

export type TaskRunner = (typeof taskRunners)[number];

/**
 * Bingo's CLI only parses `--flag value` for unions of literals, not `z.enum`s.
 */
function literalUnion<const Values extends readonly [string, string, ...string[]]>(values: Values) {
  const [first, second, ...rest] = values.map((value) => z.literal(value));
  return z.union([first, second, ...rest] as unknown as [
    z.ZodLiteral<Values[number]>,
    z.ZodLiteral<Values[number]>,
  ]);
}

/**
 * These don't use `.default()` because Bingo would prompt for them.
 */
export const rootOptionsShape = {
  author: z.string().optional().describe('author name for package.json files'),
  catalogExcluded: z
    .array(z.string())
    .optional()
    .describe('`<catalog>:<dependency>` pairs to keep out of catalogs'),
  catalogs: literalUnion(catalogModes)
    .optional()
    .describe("pnpm catalogs mode: 'default', 'named', or 'none'"),
  catalogShared: z
    .array(z.string())
    .optional()
    .describe('dependencies to put in the default catalog'),
  description: z.string().describe("'Sentence case.' description of the repository"),
  directory: z.string().optional().describe('directory to create the repository in'),
  email: z.string().optional().describe('author email for package.json files'),
  formatter: literalUnion(['oxfmt', 'prettier', 'biome', 'none'] as const)
    .optional()
    .describe(
      "formatter to use: 'biome' (existing repositories only), 'none', 'oxfmt', or 'prettier'",
    ),
  keywords: z
    .array(z.string())
    .optional()
    .describe("keywords for new packages and a new GitHub repository's topics"),
  linter: literalUnion(['eslint', 'none'] as const)
    .optional()
    .describe("linter to use: 'eslint' or 'none'"),
  newPackage: z.string().optional().describe('name of a package to add under packages/'),
  newPackageDescription: z
    .string()
    .optional()
    .describe("'Sentence case.' description of the --newPackage"),
  node: z.string().optional().describe('Node.js version for .nvmrc and CI'),
  nodeEngines: z.string().optional().describe('Node.js range for engines.node'),
  owner: z.string().describe('organization or user owning the repository'),
  packages: z.array(packageSpecSchema).optional().describe('workspace packages'),
  pnpm: z.string().optional().describe("pnpm version for package.json's packageManager field"),
  releaseApp: z.string().optional().describe("prefix of the GitHub App's variable and secret"),
  repository: z.string().describe("'kebab-case' name of the repository"),
  scope: z.string().optional().describe('npm scope for the private build package'),
  setupAction: z
    .string()
    .optional()
    .describe("name of the repository's own GitHub Action that installs dependencies"),
  taskRunner: literalUnion(taskRunners)
    .optional()
    .describe("task runner to use: 'none', 'nx', 'pnpm', or 'turbo'"),
  rootTSConfigExtended: z
    .boolean()
    .optional()
    .describe('whether packages extend the root tsconfig.json'),
  recursiveBuild: z
    .boolean()
    .optional()
    .describe("whether the root build script runs packages' build scripts"),
  testRunner: literalUnion(['vitest', 'other'] as const)
    .optional()
    .describe("test runner to use: 'vitest', or 'other' to leave existing tests alone"),
  title: z.string().describe("'Title Case' title for the repository"),
  typescript7Alias: z.string().optional().describe('dependency name that aliases TypeScript 7'),
  buildPackageSkipped: z.boolean().optional().describe('whether to skip adding the build package'),
  typescriptKept: z
    .boolean()
    .optional()
    .describe('whether to keep the existing TypeScript version'),
  vitestConfigUnowned: z
    .boolean()
    .optional()
    .describe("whether the root Vitest config is the repository's own"),
  vitestConfig: z.string().optional().describe('file name of the root Vitest config'),
  workflowExtension: literalUnion(['yaml', 'yml'] as const)
    .optional()
    .describe("GitHub Actions file extension: 'yaml' or 'yml'"),
  workflowKeysSorted: z
    .boolean()
    .optional()
    .describe('whether existing GitHub Actions workflows have sorted keys'),
};

export type RootOptionsShape = typeof rootOptionsShape;

export type RootOptions = z.infer<z.ZodObject<RootOptionsShape>>;

export const packageOptionsShape = {
  ...rootOptionsShape,
  package: packageSpecSchema,
};

export type PackageOptionsShape = typeof packageOptionsShape;

export type PackageOptions = z.infer<z.ZodObject<PackageOptionsShape>>;

export const defaults = {
  node: '26.13.1',
  nodeEngines: '^22.22.2 || ^24.15.0 || >=26.0.0',
  pnpm: '12.21.0',
  releaseApp: 'RELEASEBOT_APP',
  typescript7Alias: 'typescript7',
  workflowExtension: 'yaml',
} as const;
