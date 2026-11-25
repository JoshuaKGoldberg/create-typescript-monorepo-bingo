import { parseSync } from 'oxc-parser';

/**
 * Whether objects and arrays span multiple lines, keyed by path.
 */
export type Layout = Map<string, boolean>;

interface AstNode {
  [key: string]: unknown;
  end: number;
  start: number;
  type: string;
}

const printWidth = 100;

export function readJsonLayout(text: string | undefined): Layout | undefined {
  if (text === undefined) {
    return undefined;
  }

  const source = `(${text})`;
  const { errors, program } = parseSync('file.ts', source);
  const statement = (program.body as unknown as (AstNode | undefined)[])[0];
  if (errors.length || statement?.type !== 'ExpressionStatement') {
    return undefined;
  }

  return readLayout(source, statement.expression as AstNode);
}

export function readLayout(source: string, node: AstNode): Layout {
  const layout: Layout = new Map();

  const visit = (current: AstNode, path: string) => {
    if (current.type === 'ParenthesizedExpression') {
      visit(current.expression as AstNode, path);
      return;
    }

    if (current.type === 'ObjectExpression') {
      layout.set(path, source.slice(current.start, current.end).includes('\n'));
      for (const property of current.properties as AstNode[]) {
        const key = property.key as AstNode | undefined;
        const name =
          key?.type === 'Identifier' ? key.name : key?.type === 'Literal' ? key.value : undefined;
        if (typeof name === 'string' && property.value) {
          visit(property.value as AstNode, `${path}/${name}`);
        }
      }
    } else if (current.type === 'ArrayExpression') {
      layout.set(path, source.slice(current.start, current.end).includes('\n'));
      for (const [index, element] of (current.elements as (AstNode | null)[]).entries()) {
        if (element) {
          visit(element, `${path}/${String(index)}`);
        }
      }
    }
  };

  visit(node, '');
  return layout;
}

export interface PrintSettings {
  indentUnit?: string;
  layout?: Layout;
  style: 'json' | 'ts';
}

export function printValue(value: unknown, settings: PrintSettings): string {
  return print(value, settings, '', '', 0);
}

function print(
  value: unknown,
  settings: PrintSettings,
  path: string,
  indent: string,
  prefixLength: number,
  siblingHint?: boolean,
): string {
  if (value === null || typeof value !== 'object') {
    return printPrimitive(value, settings);
  }

  if (isRegExpLiteral(value)) {
    return value.regex;
  }

  const isArray = Array.isArray(value);
  const entries: [string, unknown][] = isArray
    ? value.map((item, index) => [String(index), item])
    : Object.entries(value).filter(([, item]) => item !== undefined);
  const [open, close] = isArray ? ['[', ']'] : ['{', '}'];

  if (!entries.length) {
    return `${open}${close}`;
  }

  // New elements match the layout of their siblings
  const elementHint = isArray
    ? entries
        .map(([key]) => settings.layout?.get(`${path}/${key}`))
        .find((hint) => hint !== undefined)
    : undefined;

  const printEntry = (key: string, item: unknown, entryIndent: string, entryPrefix: number) => {
    const keyText = isArray ? '' : `${printKey(key, settings)}: `;
    return `${keyText}${print(
      item,
      settings,
      `${path}/${key}`,
      entryIndent,
      entryPrefix + keyText.length,
      elementHint,
    )}`;
  };

  const inline = entries.map(([key, item]) => printEntry(key, item, indent, 0)).join(', ');
  const inlineText = isArray ? `${open}${inline}${close}` : `${open} ${inline} ${close}`;

  const hinted = settings.layout?.get(path) ?? siblingHint;
  const fits =
    !inlineText.includes('\n') && indent.length + prefixLength + inlineText.length <= printWidth;
  const multiline =
    hinted ??
    (!fits ||
      (!isArray && settings.style === 'json') ||
      entries.some(
        ([, item]) => item !== null && typeof item === 'object' && !isRegExpLiteral(item),
      ));

  if (!multiline && fits) {
    return inlineText;
  }

  const inner = `${indent}${settings.indentUnit ?? '  '}`;
  const lines = entries.map(
    ([key, item], index) =>
      `${inner}${printEntry(key, item, inner, 0)}${
        settings.style === 'json' && index === entries.length - 1 ? '' : ','
      }`,
  );

  return `${open}\n${lines.join('\n')}\n${indent}${close}`;
}

function printKey(key: string, settings: PrintSettings) {
  if (settings.style === 'json') {
    return JSON.stringify(key);
  }

  return /^[A-Z_$][\w$]*$/i.test(key) ? key : quoteSingle(key);
}

function printPrimitive(value: unknown, settings: PrintSettings) {
  if (typeof value === 'string') {
    return settings.style === 'json' ? JSON.stringify(value) : quoteSingle(value);
  }

  return JSON.stringify(value);
}

function quoteSingle(text: string) {
  return `'${text.replaceAll('\\', '\\\\').replaceAll("'", "\\'").replaceAll('\n', '\\n')}'`;
}

interface RegExpLiteral {
  regex: string;
}

function isRegExpLiteral(value: object): value is RegExpLiteral {
  return 'regex' in value && Object.keys(value).length === 1;
}
