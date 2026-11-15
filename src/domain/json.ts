import { createHash } from 'node:crypto';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type PathPart = string | number;

export const INPUT_LIMITS = { bytes: 65_536, depth: 20, nodes: 2_000 } as const;

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export class PayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayloadError';
  }
}

// Compare decimal values rather than spelling: 1.00 and 1e0 have the same value.
// Ordinary JSON decimals are allowed, but literals that silently lose decimal
// digits on a Number -> string round trip are rejected.
function decimalForm(token: string): string {
  const negative = token.startsWith('-');
  const [mantissa, exponentText = '0'] = token.replace(/^-/, '').toLowerCase().split('e');
  const fractionLength = mantissa.includes('.') ? mantissa.length - mantissa.indexOf('.') - 1 : 0;
  let digits = mantissa.replace('.', '').replace(/^0+/, '');
  if (!digits) return '0';
  let exponent = Number(exponentText) - fractionLength;
  while (digits.endsWith('0')) {
    digits = digits.slice(0, -1);
    exponent += 1;
  }
  return `${negative ? '-' : ''}${digits}e${exponent}`;
}

function readNumber(token: string): number {
  if (token.length > 128) throw new PayloadError('A numeric literal is too long. Encode identifiers as JSON strings.');
  const value = Number(token);
  if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) {
    throw new PayloadError('An unsafe numeric literal was found. Encode long identifiers as JSON strings before scanning.');
  }
  if (decimalForm(token) !== decimalForm(String(value))) {
    throw new PayloadError('A numeric literal would lose precision. Encode the exact value as a JSON string.');
  }
  return value;
}

/** Strict JSON parsing with bounds enforced while reading, not after allocation. */
export function parsePayload(source: string): JsonValue {
  if (typeof source !== 'string') throw new PayloadError('Supply a JSON string.');
  if (Buffer.byteLength(source, 'utf8') > INPUT_LIMITS.bytes) throw new PayloadError('JSON must be at most 64 KiB.');
  if (!source.trim()) throw new PayloadError('Paste a non-empty JSON payload.');
  let position = 0;
  let nodes = 0;
  const whitespace = () => { while (/[\t\n\r ]/.test(source[position] ?? '\0')) position += 1; };
  const fail = (): never => { throw new PayloadError(`Invalid JSON near character ${position + 1}.`); };

  function string(): string {
    const start = position;
    if (source[position++] !== '"') return fail();
    while (position < source.length) {
      const character = source[position++];
      if (character === '"') {
        // This call parses one already-validated string literal, never an object
        // or a numeric token. It also decodes escaped keys for duplicate checks.
        return JSON.parse(source.slice(start, position)) as string;
      }
      if (character.charCodeAt(0) < 0x20) return fail();
      if (character === '\\') {
        const escape = source[position++];
        if (escape === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(source.slice(position, position + 4))) return fail();
          position += 4;
        } else if (!escape || !'"\\/bfnrt'.includes(escape)) return fail();
      }
    }
    return fail();
  }

  function value(depth: number): JsonValue {
    whitespace();
    if (depth > INPUT_LIMITS.depth) throw new PayloadError('JSON nesting must be at most 20 levels.');
    nodes += 1;
    if (nodes > INPUT_LIMITS.nodes) throw new PayloadError('JSON must contain at most 2,000 values.');
    const character = source[position];
    if (character === '"') return string();
    if (character === '{') {
      position += 1;
      whitespace();
      const result: { [key: string]: JsonValue } = Object.create(null) as { [key: string]: JsonValue };
      const keys = new Set<string>();
      if (source[position] === '}') { position += 1; return result; }
      while (position < source.length) {
        whitespace();
        if (source[position] !== '"') return fail();
        const key = string();
        if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new PayloadError('Prototype-related object keys are not supported.');
        if (keys.has(key)) throw new PayloadError('Duplicate object keys are not supported.');
        keys.add(key);
        whitespace();
        if (source[position++] !== ':') return fail();
        result[key] = value(depth + 1);
        whitespace();
        const delimiter = source[position++];
        if (delimiter === '}') return result;
        if (delimiter !== ',') return fail();
      }
      return fail();
    }
    if (character === '[') {
      position += 1;
      whitespace();
      const result: JsonValue[] = [];
      if (source[position] === ']') { position += 1; return result; }
      while (position < source.length) {
        result.push(value(depth + 1));
        whitespace();
        const delimiter = source[position++];
        if (delimiter === ']') return result;
        if (delimiter !== ',') return fail();
      }
      return fail();
    }
    for (const [literal, parsed] of [['true', true], ['false', false], ['null', null]] as const) {
      if (source.startsWith(literal, position)) { position += literal.length; return parsed; }
    }
    const numeric = source.slice(position).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (numeric) {
      position += numeric[0].length;
      return readNumber(numeric[0]);
    }
    return fail();
  }

  const result = value(0);
  whitespace();
  if (position !== source.length) fail();
  return result;
}

export interface Leaf {
  parts: PathPart[];
  path: string;
  fieldName: string;
  group: string;
  value: null | boolean | number | string;
}

export function displayPath(parts: PathPart[]): string {
  return '$' + parts.map(part => typeof part === 'number' ? `[${part}]` : /^[A-Za-z_$][\w$]*$/.test(part) ? `.${part}` : `[${JSON.stringify(part)}]`).join('');
}

export function leavesOf(root: JsonValue): Leaf[] {
  const leaves: Leaf[] = [];
  function visit(item: JsonValue, parts: PathPart[], groupParts: string[], fieldName: string): void {
    if (Array.isArray(item)) {
      item.forEach((child, index) => visit(child, [...parts, index], [...groupParts, '[]'], fieldName));
    } else if (item !== null && typeof item === 'object') {
      Object.entries(item).forEach(([key, child]) => visit(child, [...parts, key], [...groupParts, JSON.stringify(key)], key));
    } else {
      leaves.push({ parts, path: displayPath(parts), group: groupParts.join('/'), fieldName, value: item });
    }
  }
  visit(root, [], [], '(root)');
  return leaves;
}

export function mapLeaves(root: JsonValue, transform: (value: Leaf['value']) => Leaf['value']): JsonValue {
  if (Array.isArray(root)) return root.map(child => mapLeaves(child, transform));
  if (root !== null && typeof root === 'object') {
    const result = Object.create(null) as { [key: string]: JsonValue };
    Object.entries(root).forEach(([key, value]) => { result[key] = mapLeaves(value, transform); });
    return result;
  }
  return transform(root);
}

export function valueAt(root: JsonValue, parts: PathPart[]): JsonValue {
  let value = root;
  for (const part of parts) {
    if (value === null || typeof value !== 'object') throw new PayloadError('A selected path is no longer available. Scan the payload again.');
    value = (value as Record<string | number, JsonValue>)[part];
  }
  return value;
}
