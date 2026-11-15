// Bounded JSON parser shared by the local command runner. No payload values are
// interpolated into errors: callers may safely show the stable error code.
export class VerificationError extends Error {
  constructor(code) {
    super(code);
    this.name = 'VerificationError';
    this.code = code;
  }
}

export const JSON_LIMITS = Object.freeze({ bytes: 65_536, depth: 32, nodes: 8_192, keys: 4_096, array: 2_000, string: 16_384 });
const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor']);

export function parseBoundedJson(bytes, limits = JSON_LIMITS) {
  const input = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (input.length > limits.bytes) throw new VerificationError('json-size-limit');
  // TextDecoder rejects malformed UTF-8 instead of hashing one value but running
  // another through replacement characters.
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(input); }
  catch { throw new VerificationError('invalid-json'); }
  let offset = 0;
  let nodes = 0;
  let keys = 0;
  const fail = () => { throw new VerificationError('invalid-json'); };
  const whitespace = () => { while (/[\u0009\u000a\u000d\u0020]/.test(text[offset] ?? '\0')) offset++; };
  function string() {
    const start = offset++;
    while (offset < text.length) {
      const character = text[offset++];
      if (character === '\\') { offset++; continue; }
      if (character === '"') {
        let value;
        try { value = JSON.parse(text.slice(start, offset)); } catch { fail(); }
        if (value.length > limits.string) throw new VerificationError('json-string-limit');
        // Lone surrogates have ambiguous Unicode/UTF-8 behavior across oracles.
        if (!value.isWellFormed()) throw new VerificationError('invalid-unicode');
        return value;
      }
    }
    fail();
  }
  function value(depth) {
    if (++nodes > limits.nodes || depth > limits.depth) throw new VerificationError('json-complexity-limit');
    whitespace();
    const next = text[offset];
    if (next === '"') return string();
    if (next === '{') {
      offset++;
      const result = Object.create(null);
      whitespace();
      if (text[offset] === '}') { offset++; return result; }
      while (true) {
        whitespace();
        if (text[offset] !== '"') fail();
        const key = string();
        if (unsafeKeys.has(key)) throw new VerificationError('unsafe-json-key');
        if (Object.hasOwn(result, key)) throw new VerificationError('duplicate-json-key');
        if (++keys > limits.keys) throw new VerificationError('json-complexity-limit');
        whitespace();
        if (text[offset++] !== ':') fail();
        result[key] = value(depth + 1);
        whitespace();
        const separator = text[offset++];
        if (separator === '}') return result;
        if (separator !== ',') fail();
      }
    }
    if (next === '[') {
      offset++;
      const result = [];
      whitespace();
      if (text[offset] === ']') { offset++; return result; }
      while (true) {
        if (result.length >= limits.array) throw new VerificationError('json-array-limit');
        result.push(value(depth + 1));
        whitespace();
        const separator = text[offset++];
        if (separator === ']') return result;
        if (separator !== ',') fail();
      }
    }
    for (const [token, primitive] of [['true', true], ['false', false], ['null', null]]) {
      if (text.startsWith(token, offset)) { offset += token.length; return primitive; }
    }
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(offset));
    if (!match) fail();
    offset += match[0].length;
    const number = Number(match[0]);
    if (!Number.isFinite(number)) throw new VerificationError('nonfinite-json-number');
    return number;
  }
  const result = value(0);
  whitespace();
  if (offset !== text.length) fail();
  return result;
}

export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
}
