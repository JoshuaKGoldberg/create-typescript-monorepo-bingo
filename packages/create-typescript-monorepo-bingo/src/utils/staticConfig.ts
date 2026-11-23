import { parseSync } from 'oxc-parser';

import { type Layout, printValue, readLayout } from './print.ts';

interface AstNode {
  [key: string]: unknown;
  type: string;
}

/**
 * A value that can be statically read from, and printed back to, a config file.
 * Regular expressions are kept as their source text.
 */
export type StaticValue =
  | boolean
  | null
  | number
  | StaticRegExp
  | StaticValue[]
  | string
  | { [key: string]: StaticValue };

export interface StaticRegExp {
  regex: string;
}

/**
 * Reads the object a config file exports by default, if it can be statically evaluated.
 * Handles `export default {...}`, `export default defineConfig({...})`,
 * and `const config = ...; export default config;`.
 * Any part that can't be evaluated (a spread, a function call, an identifier) makes it fail.
 */
export function readConfigObject(sourceText: string | undefined): StaticObject | undefined {
  const node = findConfigNode(sourceText);
  const value = node && evaluate(node);

  return isStaticObject(value) ? value : undefined;
}

/**
 * Reads the layout of the object a config file exports by default.
 * @see readConfigObject
 */
export function readConfigLayout(sourceText: string | undefined): Layout | undefined {
  const node = findConfigNode(sourceText);
  return node && sourceText !== undefined
    ? readLayout(sourceText, node as Parameters<typeof readLayout>[1])
    : undefined;
}

function findConfigNode(sourceText: string | undefined): AstNode | undefined {
  if (sourceText === undefined) {
    return undefined;
  }

  const { errors, program } = parseSync('config.ts', sourceText);
  if (errors.length) {
    return undefined;
  }

  const body = program.body as unknown as AstNode[];
  const exported = body.find((node) => node.type === 'ExportDefaultDeclaration')?.declaration as
    | AstNode
    | undefined;
  if (!exported) {
    return undefined;
  }

  const resolved = resolveIdentifier(body, exported);
  return resolved && unwrapCalls(resolved);
}

export type StaticObject = Record<string, StaticValue>;

export interface ESLintIgnoresSource {
  /**
   * Source lines of the array's elements, including any comments between them.
   */
  lines: string[];
  values: string[];
}

/**
 * Reads a flat ESLint config's global ignores, along with their source lines,
 * so comments between entries can be kept.
 */
export function readESLintIgnoresWithSource(
  sourceText: string | undefined,
): ESLintIgnoresSource | undefined {
  if (sourceText === undefined) {
    return undefined;
  }

  const { errors, program } = parseSync('eslint.config.ts', sourceText);
  if (errors.length) {
    return undefined;
  }

  let found: ESLintIgnoresSource | undefined;

  visit(program, (node) => {
    if (found || node.type !== 'ObjectExpression') {
      return;
    }

    const properties = node.properties as (AstNode | undefined)[];
    const [property] = properties;
    if (
      properties.length !== 1 ||
      property?.type !== 'Property' ||
      getKeyName(property.key as AstNode) !== 'ignores'
    ) {
      return;
    }

    const value = property.value as AstNode & { end: number; start: number };
    if (value.type !== 'ArrayExpression') {
      return;
    }

    const values: string[] = [];
    for (const element of value.elements as (AstNode | null)[]) {
      if (element?.type === 'Literal' && typeof element.value === 'string') {
        values.push(element.value);
      }
    }

    const inner = sourceText.slice(value.start + 1, value.end - 1);
    found = {
      lines: inner.includes('\n')
        ? inner.split('\n').filter((line) => line.trim())
        : values.map((ignore) => `'${ignore}',`),
      values,
    };
  });

  return found;
}

/**
 * Prints a static value as a TypeScript expression, keeping an existing layout.
 */
export function printStatic(value: StaticValue, layout?: Layout): string {
  return printValue(value, { layout, style: 'ts' });
}

function evaluate(node: AstNode): StaticValue | undefined {
  switch (node.type) {
    case 'ArrayExpression': {
      const items: StaticValue[] = [];
      for (const element of node.elements as (AstNode | null)[]) {
        const item = element && evaluate(element);
        if (item === undefined || item === null) {
          return undefined;
        }
        items.push(item);
      }
      return items;
    }

    case 'Literal':
      if (node.regex) {
        return { regex: node.raw as string };
      }
      return node.value as boolean | null | number | string;

    case 'ObjectExpression': {
      const result: StaticObject = {};
      for (const property of node.properties as AstNode[]) {
        if (property.type !== 'Property' || property.computed || property.kind !== 'init') {
          return undefined;
        }

        const key = getKeyName(property.key as AstNode);
        const value = evaluate(property.value as AstNode);
        if (key === undefined || value === undefined) {
          return undefined;
        }

        result[key] = value;
      }
      return result;
    }

    case 'TemplateLiteral': {
      const quasis = node.quasis as AstNode[];
      return (node.expressions as unknown[]).length
        ? undefined
        : ((quasis[0]?.value as { cooked: string } | undefined)?.cooked ?? '');
    }

    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
      return evaluate(node.expression as AstNode);

    default:
      return undefined;
  }
}

function getKeyName(key: AstNode): string | undefined {
  if (key.type === 'Identifier') {
    return key.name as string;
  }

  if (key.type === 'Literal' && typeof key.value === 'string') {
    return key.value;
  }

  return undefined;
}

function isStaticObject(value: StaticValue | undefined): value is StaticObject {
  return !!value && typeof value === 'object' && !Array.isArray(value) && !isStaticRegExp(value);
}

function isStaticRegExp(value: object): value is StaticRegExp {
  return 'regex' in value && Object.keys(value).length === 1;
}

function resolveIdentifier(body: AstNode[], node: AstNode): AstNode | undefined {
  if (node.type !== 'Identifier') {
    return node;
  }

  for (const statement of body) {
    const declaration =
      statement.type === 'ExportNamedDeclaration'
        ? (statement.declaration as AstNode | null)
        : statement;

    if (declaration?.type !== 'VariableDeclaration') {
      continue;
    }

    for (const declarator of declaration.declarations as AstNode[]) {
      const id = declarator.id as AstNode;
      if (id.type === 'Identifier' && id.name === node.name && declarator.init) {
        return declarator.init as AstNode;
      }
    }
  }

  return undefined;
}

function unwrapCalls(node: AstNode): AstNode {
  // defineConfig({...}) and similar single-argument wrappers.
  if (node.type === 'CallExpression') {
    const args = node.arguments as AstNode[];
    if (args.length === 1 && args[0]) {
      return unwrapCalls(args[0]);
    }
  }

  if (node.type === 'TSAsExpression' || node.type === 'TSSatisfiesExpression') {
    return unwrapCalls(node.expression as AstNode);
  }

  return node;
}

function visit(node: unknown, callback: (node: AstNode) => void) {
  if (!node || typeof node !== 'object') {
    return;
  }

  if (Array.isArray(node)) {
    for (const child of node) {
      visit(child, callback);
    }
    return;
  }

  const astNode = node as AstNode;
  if (typeof astNode.type === 'string') {
    callback(astNode);
  }

  for (const [key, child] of Object.entries(astNode)) {
    if (key !== 'parent') {
      visit(child, callback);
    }
  }
}
