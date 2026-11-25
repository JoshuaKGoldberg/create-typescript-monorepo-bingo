/**
 * Whether root scripts use a tsconfig.json to write files.
 */
export function emitsFiles(compilerOptions: unknown, scripts: string[]): boolean {
  const { declarationDir, noEmit, outDir, outFile } = (compilerOptions ?? {}) as Record<
    string,
    unknown
  >;
  return noEmit === undefined
    ? !!(declarationDir ?? outDir ?? outFile) &&
        scripts.some((script) => /(?:^|[\s;&|(])tsc(?:\s(?![^&|;]*--noEmit)|$)/.test(script))
    : !noEmit;
}
