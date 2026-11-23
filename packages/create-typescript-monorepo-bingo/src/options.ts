import { z } from 'zod';

/**
 * What kind of workspace package a directory holds, which decides what CTM writes for it.
 * - `library`: a tsdown-built TypeScript package, which gets the full package preset.
 * - `bin-js`: a JavaScript-only bin package, which CTM leaves alone apart from listing it.
 * - `build`: the shared `@&lt;scope>/build` package, owned by the root Build block.
 * - `site`: a docs site, which is repo-owned.
 * - `repo-owned`: anything else CTM shouldn't touch.
 */
export const packageKinds = ['library', 'bin-js', 'build', 'site', 'repo-owned'] as const;

export type PackageKind = (typeof packageKinds)[number];

export const packageSpecSchema = z.object({
  description: z.string().optional(),
  directory: z.string(),
  isolatedDeclarations: z.boolean().optional(),
  kind: z.enum(packageKinds),
  name: z.string(),
  scripts: z.array(z.string()).optional(),
  tsdownWorkspaceReady: z.boolean().optional(),
  workspaceDependencies: z.array(z.string()).optional(),
});

export type PackageSpec = z.infer<typeof packageSpecSchema>;

export const catalogModes = ['none', 'default', 'named'] as const;

export type CatalogMode = (typeof catalogModes)[number];

export const taskRunners = ['none', 'pnpm', 'turbo', 'nx'] as const;

export type TaskRunner = (typeof taskRunners)[number];

/**
 * Creates a schema for one of several strings. bingo's CLI parses `--flag value` for
 * unions of literals, but not for `z.enum`, which it only reads as `--flag=value`.
 */
function literalUnion<const Values extends readonly [string, string, ...string[]]>(values: Values) {
  const [first, second, ...rest] = values.map((value) => z.literal(value));
  return z.union([first, second, ...rest] as unknown as [
    z.ZodLiteral<Values[number]>,
    z.ZodLiteral<Values[number]>,
  ]);
}

/**
 * Options for the repository as a whole.
 * None use `.default(...)`, because bingo prompts for defaulted schemas;
 * `prepare()` infers values and blocks fall back to the documented defaults.
 */
export const rootOptionsShape = {
  author: z.string().optional().describe('author name for package.json files'),
  catalogExcluded: z
    .array(z.string())
    .optional()
    .describe('dependencies (as `<catalog>:<name>`) to leave out of catalogs'),
  catalogs: literalUnion(catalogModes)
    .optional()
    .describe("pnpm catalogs to manage: 'none', 'default' (shared deps), or 'named' (by field)"),
  catalogShared: z
    .array(z.string())
    .optional()
    .describe('dependencies to put in the default catalog, in default mode'),
  description: z.string().describe('sentence-case description of the repository'),
  directory: z.string().optional().describe('directory to create the repository in'),
  email: z.string().optional().describe('author email for package.json files'),
  formatter: literalUnion(['oxfmt', 'prettier'] as const)
    .optional()
    .describe("formatter: 'oxfmt', or 'prettier' for repositories that already use it"),
  newPackage: z
    .string()
    .optional()
    .describe('name of a new package to add under packages/, such as "my-lib"'),
  newPackageDescription: z
    .string()
    .optional()
    .describe('sentence-case description of the --new-package'),
  node: z.string().optional().describe('Node.js version for .nvmrc and CI'),
  nodeEngines: z.string().optional().describe('engines.node range for package.json files'),
  owner: z.string().describe('GitHub organization or user the repository is underneath'),
  packages: z.array(packageSpecSchema).optional().describe('workspace packages'),
  pnpm: z.string().optional().describe('pnpm version for packageManager'),
  releaseApp: z
    .string()
    .optional()
    .describe('prefix of the GitHub App variable and secret used for releases'),
  repository: z.string().describe("'kebab-case' name of the repository"),
  scope: z.string().optional().describe("npm scope for the private build package, like '@my'"),
  taskRunner: literalUnion(taskRunners)
    .optional()
    .describe("task runner to orchestrate scripts: 'none', 'pnpm', 'turbo', or 'nx'"),
  title: z.string().describe("'Title Case' title for the repository"),
  typescript7Alias: z
    .string()
    .optional()
    .describe('dependency name that aliases TypeScript 7 for the tsc binary'),
  vitestConfig: z
    .string()
    .optional()
    .describe('file name of the root Vitest config, if not vitest.config.ts'),
  workflowExtension: literalUnion(['yaml', 'yml'] as const)
    .optional()
    .describe('file extension for GitHub Actions workflow files'),
};

export type RootOptionsShape = typeof rootOptionsShape;

export type RootOptions = z.infer<z.ZodObject<RootOptionsShape>>;

/**
 * Options for one package's production: every root option, plus the package being produced.
 */
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
