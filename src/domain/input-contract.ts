import { displayPath, leavesOf, parsePayload, PayloadError, sha256, type JsonValue, type Leaf, type PathPart } from './json';
import type { ProfileId } from '../shared/contracts';

/** A deliberately small input-validity language, not a JSON Schema implementation. */
export type InputSchema =
  | { type: 'object'; properties: Record<string, InputSchema>; required?: string[]; additionalProperties: false }
  | { type: 'array'; items: InputSchema; minItems?: number; maxItems?: number }
  | { type: 'string'; format?: 'email' | 'date' | 'date-time' | 'url' | 'integer-string'; minLength?: number; maxLength?: number; minimum?: string; maximum?: string; enum?: string[]; public?: true }
  | { type: 'number'; minimum?: number; maximum?: number; integer?: boolean; enum?: number[]; public?: true }
  | { type: 'boolean'; enum?: boolean[]; public?: true }
  | { type: 'null' };

export interface InputContractV1 {
  version: 1;
  schema: InputSchema;
  /** Absolute RFC 6901 pointers. No wildcard, expression, regex, or executable code. */
  relations?: Array<{ left: string; operator: 'eq' | 'lt' | 'lte'; right: string }>;
}
export type InputContract = InputContractV1;

export const CONTRACT_LIMITS = { bytes: 32_768, nodes: 128, depth: 12, properties: 64, enum: 32, relations: 32, stringLength: 4_096 } as const;
const I64_MIN = -(1n << 63n);
const I64_MAX = (1n << 63n) - 1n;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
type Scalar = Leaf['value'];
type ScalarSchema = Extract<InputSchema, { type: 'string' | 'number' | 'boolean' | 'null' }>;

function fail(message: string): never { throw new PayloadError(`Input contract: ${message}`); }
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === null || Object.getPrototypeOf(value) === Object.prototype);
}
function safeObject(value: unknown, depth = 0, seen = new Set<object>(), counter = { nodes: 0 }): void {
  if (++counter.nodes > 2_000) fail('JSON must contain at most 2,000 values.');
  if (depth > 20) fail('object nesting is too deep.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return;
  // Decimal numeric limits are allowed, but unsafe magnitudes and non-finite limits are not.
  if (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER) return;
  if (typeof value !== 'object' || !value || (!Array.isArray(value) && !record(value))) fail('only plain JSON values are supported.');
  if (seen.has(value)) fail('cycles are not supported.');
  seen.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Array.isArray(value) && Object.keys(descriptors).length !== value.length + 1) fail('sparse arrays or additional array properties are not supported.');
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || FORBIDDEN_KEYS.has(key)) fail('prototype-related or symbol keys are not supported.');
    if (Array.isArray(value) && key === 'length') continue;
    const descriptor = descriptors[key];
    if (Array.isArray(value) && (!/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) fail('additional array properties are not supported.');
    if (!descriptor.enumerable || !('value' in descriptor)) fail('only enumerable JSON data properties are supported.');
    safeObject(descriptor.value, depth + 1, seen, counter);
  }
  seen.delete(value);
}
function allowed(object: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(object).some(key => !keys.includes(key))) fail('an unsupported keyword was supplied.');
}
function boundedInteger(value: unknown, name: string, maximum: number): void {
  if (value !== undefined && (!Number.isInteger(value) || (value as number) < 0 || (value as number) > maximum)) fail(`${name} is outside the supported bounds.`);
}
function canonicalInteger(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 20 && /^(?:0|-?[1-9]\d*)$/.test(value)
    && BigInt(value) >= I64_MIN && BigInt(value) <= I64_MAX;
}
function pointerParts(pointer: string): string[] {
  if (pointer === '') return [];
  if (pointer.length > 256 || !pointer.startsWith('/') || /~(?:[^01]|$)/.test(pointer)) fail('relations require bounded absolute JSON Pointers.');
  const parts = pointer.slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'));
  if (parts.some(part => FORBIDDEN_KEYS.has(part) || part === '*')) fail('relation pointers cannot use prototype keys or wildcards.');
  return parts;
}

export function parseInputContract(input: string | unknown): InputContractV1 {
  if (typeof input === 'string' && Buffer.byteLength(input, 'utf8') > CONTRACT_LIMITS.bytes) fail('JSON must be at most 32 KiB.');
  const value: unknown = typeof input === 'string' ? parsePayload(input) : input;
  safeObject(value);
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > CONTRACT_LIMITS.bytes) fail('JSON must be at most 32 KiB.');
  if (!record(value)) fail('supply a version 1 object.');
  allowed(value, ['version', 'schema', 'relations']);
  if (value.version !== 1) fail('only version 1 is supported.');
  let nodes = 0;
  function schema(item: unknown, depth: number): void {
    if (++nodes > CONTRACT_LIMITS.nodes || depth > CONTRACT_LIMITS.depth) fail('schema complexity exceeds the supported bounds.');
    if (!record(item)) fail('every schema node must be an object.');
    if (item.type === 'object') {
      allowed(item, ['type', 'properties', 'required', 'additionalProperties']);
      if (!record(item.properties) || Object.keys(item.properties).length > CONTRACT_LIMITS.properties || item.additionalProperties !== false) fail('objects must declare bounded properties and additionalProperties:false.');
      if (item.required !== undefined && (!Array.isArray(item.required) || item.required.length > CONTRACT_LIMITS.properties
        || item.required.some(key => typeof key !== 'string' || !Object.hasOwn(item.properties as object, key))
        || new Set(item.required).size !== item.required.length)) fail('required must contain distinct declared property names.');
      Object.values(item.properties).forEach(child => schema(child, depth + 1));
    } else if (item.type === 'array') {
      allowed(item, ['type', 'items', 'minItems', 'maxItems']);
      boundedInteger(item.minItems, 'minItems', 2_000); boundedInteger(item.maxItems, 'maxItems', 2_000);
      if (Number(item.minItems ?? 0) > Number(item.maxItems ?? 2_000)) fail('array bounds are inverted.');
      schema(item.items, depth + 1);
    } else if (item.type === 'string') {
      allowed(item, ['type', 'format', 'minLength', 'maxLength', 'minimum', 'maximum', 'enum', 'public']);
      if (item.format !== undefined && !['email', 'date', 'date-time', 'url', 'integer-string'].includes(item.format as string)) fail('unsupported string format.');
      boundedInteger(item.minLength, 'minLength', CONTRACT_LIMITS.stringLength); boundedInteger(item.maxLength, 'maxLength', CONTRACT_LIMITS.stringLength);
      if (Number(item.minLength ?? 0) > Number(item.maxLength ?? CONTRACT_LIMITS.stringLength)) fail('string length bounds are inverted.');
      if ((item.minimum !== undefined || item.maximum !== undefined) && item.format !== 'integer-string') fail('string numeric bounds require integer-string format.');
      if ((item.minimum !== undefined && !canonicalInteger(item.minimum)) || (item.maximum !== undefined && !canonicalInteger(item.maximum))) fail('integer-string bounds must be canonical signed 64-bit decimal strings.');
      if (BigInt((item.minimum ?? I64_MIN) as string | bigint) > BigInt((item.maximum ?? I64_MAX) as string | bigint)) fail('integer-string bounds are inverted.');
    } else if (item.type === 'number') {
      allowed(item, ['type', 'minimum', 'maximum', 'integer', 'enum', 'public']);
      for (const key of ['minimum', 'maximum']) if (item[key] !== undefined && (typeof item[key] !== 'number' || !Number.isFinite(item[key]) || Math.abs(item[key] as number) > Number.MAX_SAFE_INTEGER)) fail('numeric bounds must be finite safe magnitudes.');
      if (item.integer !== undefined && typeof item.integer !== 'boolean') fail('integer must be boolean.');
      if (Number(item.minimum ?? -Number.MAX_SAFE_INTEGER) > Number(item.maximum ?? Number.MAX_SAFE_INTEGER)) fail('numeric bounds are inverted.');
    } else if (item.type === 'boolean') allowed(item, ['type', 'enum', 'public']);
    else if (item.type === 'null') allowed(item, ['type']);
    else fail('unsupported schema type.');
    if (['string', 'number', 'boolean'].includes(String(item.type))) {
      if (item.public !== undefined && item.public !== true) fail('public may only be true.');
      if (item.enum !== undefined) {
        if (item.public !== true || !Array.isArray(item.enum) || item.enum.length < 1 || item.enum.length > CONTRACT_LIMITS.enum
          || item.enum.some(entry => typeof entry !== item.type) || new Set(item.enum).size !== item.enum.length) fail('enum requires distinct scalar constants and public:true.');
        if (item.enum.some(entry => !scalarValid(entry as Scalar, item as unknown as ScalarSchema, true))) fail('an enum constant violates its declared format or bounds.');
      } else if (item.public !== undefined) fail('public:true requires an explicit enum.');
    }
  }
  schema(value.schema, 0);
  if (value.relations !== undefined) {
    if (!Array.isArray(value.relations) || value.relations.length > CONTRACT_LIMITS.relations) fail('too many relations.');
    for (const relation of value.relations) {
      if (!record(relation)) fail('each relation must be an object.');
      allowed(relation, ['left', 'operator', 'right']);
      if (typeof relation.left !== 'string' || typeof relation.right !== 'string' || !['eq', 'lt', 'lte'].includes(relation.operator as string)) fail('unsupported relation.');
      pointerParts(relation.left); pointerParts(relation.right);
    }
  }
  return value as unknown as InputContractV1;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function canonicalInputContract(contract: InputContractV1): string { return canonical(parseInputContract(contract)); }
export function inputContractHash(contract: InputContractV1): string { return sha256(canonicalInputContract(contract)); }

function scalarValid(value: Scalar, schema: ScalarSchema, ignoreEnum = false): boolean {
  if (schema.type === 'null') return value === null;
  if (typeof value !== schema.type) return false;
  if (!ignoreEnum && schema.enum && !(schema.enum as Scalar[]).includes(value)) return false;
  if (schema.type === 'string' && typeof value === 'string') {
    // Length is Unicode code points, deliberately independent of UTF-16 spelling.
    const length = [...value].length;
    if (length < (schema.minLength ?? 0) || length > (schema.maxLength ?? CONTRACT_LIMITS.stringLength)) return false;
    if (schema.format === 'email') return value.length <= 254 && /^[a-z0-9][a-z0-9._+-]*@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(value);
    if (schema.format === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
    if (schema.format === 'date-time') return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === (value.includes('.') ? value : value.replace('Z', '.000Z'));
    if (schema.format === 'url') {
      try { const url = new URL(value); return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password; } catch { return false; }
    }
    if (schema.format === 'integer-string') return canonicalInteger(value) && BigInt(value) >= BigInt(schema.minimum ?? I64_MIN) && BigInt(value) <= BigInt(schema.maximum ?? I64_MAX);
  }
  if (schema.type === 'number' && typeof value === 'number') return Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER
    && value >= (schema.minimum ?? -Number.MAX_SAFE_INTEGER) && value <= (schema.maximum ?? Number.MAX_SAFE_INTEGER) && (!schema.integer || Number.isInteger(value));
  return true;
}

interface Located { leaf: Leaf; schema: ScalarSchema }
function inspect(payload: JsonValue, contract: InputContractV1): { located: Located[]; violations: string[] } {
  const located: Located[] = []; const violations: string[] = [];
  function add(path: string, rule: string): void { if (violations.length < 32) violations.push(`${path}: ${rule}`); }
  function visit(value: JsonValue, schema: InputSchema, parts: PathPart[]): void {
    const path = displayPath(parts);
    if (schema.type === 'object') {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return add(path, 'expected an object');
      if (Object.keys(value).some(key => !Object.hasOwn(schema.properties, key))) add(path, 'an undeclared property is present');
      if (schema.required?.some(key => !Object.hasOwn(value, key))) add(path, 'a required property is absent');
      for (const [key, child] of Object.entries(value)) if (Object.hasOwn(schema.properties, key)) visit(child, schema.properties[key], [...parts, key]);
    } else if (schema.type === 'array') {
      if (!Array.isArray(value)) return add(path, 'expected an array');
      if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? 2_000)) add(path, 'array length is outside the declared bounds');
      value.forEach((child, index) => visit(child, schema.items, [...parts, index]));
    } else {
      if ((value !== null && typeof value === 'object') || !scalarValid(value as Scalar, schema)) add(path, 'scalar type, format, enum, or bounds differ');
      else located.push({ leaf: { parts, path, fieldName: String(parts.at(-1) ?? '(root)'), group: '', value: value as Scalar }, schema });
    }
  }
  visit(payload, contract.schema, []);
  function at(pointer: string): { value: JsonValue; schema: InputSchema } | undefined {
    let value = payload; let schema = contract.schema;
    for (const part of pointerParts(pointer)) {
      if (schema.type === 'object' && value !== null && !Array.isArray(value) && typeof value === 'object' && Object.hasOwn(value, part) && Object.hasOwn(schema.properties, part)) { value = value[part]; schema = schema.properties[part]; }
      else if (schema.type === 'array' && Array.isArray(value) && /^(?:0|[1-9]\d*)$/.test(part) && Number(part) < value.length) { value = value[Number(part)]; schema = schema.items; }
      else return undefined;
    }
    return { value, schema };
  }
  for (const relation of contract.relations ?? []) {
    const left = at(relation.left); const right = at(relation.right);
    let passed = false;
    if (left && right && left.value !== null && right.value !== null && typeof left.value !== 'object' && typeof right.value !== 'object' && typeof left.value === typeof right.value) {
      if (relation.operator === 'eq') passed = left.value === right.value;
      else {
        const integer = left.schema.type === 'string' && right.schema.type === 'string' && left.schema.format === 'integer-string' && right.schema.format === 'integer-string';
        const temporal = left.schema.type === 'string' && right.schema.type === 'string' && left.schema.format === right.schema.format && ['date', 'date-time'].includes(left.schema.format ?? '');
        if (typeof left.value === 'number' && typeof right.value === 'number') passed = relation.operator === 'lt' ? left.value < right.value : left.value <= right.value;
        else if (integer && typeof left.value === 'string' && typeof right.value === 'string' && canonicalInteger(left.value) && canonicalInteger(right.value)) passed = relation.operator === 'lt' ? BigInt(left.value) < BigInt(right.value) : BigInt(left.value) <= BigInt(right.value);
        else if (temporal && typeof left.value === 'string' && typeof right.value === 'string') passed = relation.operator === 'lt' ? Date.parse(left.value) < Date.parse(right.value) : Date.parse(left.value) <= Date.parse(right.value);
      }
    }
    if (!passed) add('$', 'a declared scalar relation is absent, unsupported for its types, or false');
  }
  return { located, violations };
}

export function validateContractPayload(payload: JsonValue, contract: InputContractV1): { valid: boolean; violations: string[] } {
  const parsed = parseInputContract(contract);
  // Reparse to apply the same prototype, value, depth and size bounds as generation.
  safeObject(payload);
  const bounded = parsePayload(JSON.stringify(payload));
  const { violations } = inspect(bounded, parsed);
  return { valid: violations.length === 0, violations };
}

export interface ConstrainedFixtures {
  synthetic: JsonValue; ordinary: JsonValue; contract: InputContractV1; contractHash: string;
  disclosures: string[]; retainedPublicPaths: string[];
  transformations: Array<{ path: string; rule: string }>;
}
interface Group { source: Scalar; entries: Located[]; selected: boolean; rank: number }
const scalarKey = (value: Scalar): string => `${typeof value}:${String(value)}`;

/** Repair generated leaves under a bounded contract, or refuse; never silently relax it. */
export function constrainFixtures(input: {
  source: JsonValue; synthetic: JsonValue; ordinary: JsonValue; contract: InputContractV1;
  profileId: ProfileId; selectedPaths: string[]; seed: string;
}): ConstrainedFixtures {
  const contract = parseInputContract(input.contract);
  const sourceResult = validateContractPayload(input.source, contract);
  if (!sourceResult.valid) fail(`source payload is invalid (${sourceResult.violations.join('; ')}).`);
  const located = inspect(input.source, contract).located;
  const selected = new Set(input.selectedPaths);
  const groups = new Map<string, Group>();
  for (const entry of located) {
    const key = scalarKey(entry.leaf.value); const group = groups.get(key) ?? { source: entry.leaf.value, entries: [], selected: false, rank: 0 };
    group.entries.push(entry); group.selected ||= selected.has(entry.leaf.path); groups.set(key, group);
  }
  // Monotonic fallback for dates and numbers preserves declared simple order relations.
  for (const type of ['string', 'number', 'boolean', 'object']) {
    [...groups.values()].filter(group => typeof group.source === type).sort((a, b) => typeof a.source === 'number' && typeof b.source === 'number' ? a.source - b.source : String(a.source).localeCompare(String(b.source))).forEach((group, rank) => { group.rank = rank; });
  }
  const originals = new Set([...groups.values()].filter(group => typeof group.source === 'string' || typeof group.source === 'number').map(group => scalarKey(group.source)));
  const digest = sha256(`ReproShare/input-contract/v1:${input.seed}:${inputContractHash(contract)}`);
  const syntheticLeaves = new Map(leavesOf(input.synthetic).map(leaf => [leaf.path, leaf.value]));
  const ordinaryLeaves = new Map(leavesOf(input.ordinary).map(leaf => [leaf.path, leaf.value]));
  const retainedPublicPaths: string[] = [];
  const disclosures: string[] = [];
  const valid = (value: Scalar, group: Group): boolean => group.entries.every(entry => scalarValid(value, entry.schema));
  const isPublic = (group: Group): boolean => group.entries.every(entry => entry.schema.type !== 'null' && entry.schema.enum?.includes(group.source as never) && entry.schema.public === true);
  const available = (value: Scalar, group: Group, used: Set<string>): boolean => valid(value, group) && !originals.has(scalarKey(value)) && !used.has(scalarKey(value));
  const selectedGroups = [...groups.values()].filter(group => group.selected);
  if (selectedGroups.some(group => typeof group.source !== 'string' || isPublic(group))) fail('selected identifiers must be private strings with replaceable values.');
  function integerBounds(group: Group): [bigint, bigint] {
    let minimum = I64_MIN; let maximum = I64_MAX;
    for (const entry of group.entries) {
      if (entry.schema.type !== 'string' || (entry.schema.format !== undefined && entry.schema.format !== 'integer-string')) fail('precision identifiers require unformatted or integer-string schemas.');
      minimum = minimum > BigInt(entry.schema.minimum ?? I64_MIN) ? minimum : BigInt(entry.schema.minimum ?? I64_MIN);
      maximum = maximum < BigInt(entry.schema.maximum ?? I64_MAX) ? maximum : BigInt(entry.schema.maximum ?? I64_MAX);
    }
    return [minimum, maximum];
  }
  function choosePrecision(output: Map<string, Scalar>, used: Set<string>, ordinary: boolean): void {
    const buckets = new Map<string, Group[]>();
    for (const group of selectedGroups) {
      const key = ordinary ? scalarKey(group.source) : String(Number(group.source));
      const bucket = buckets.get(key) ?? []; bucket.push(group); buckets.set(key, bucket);
    }
    const usedNumbers = new Set<string>(); let bucketIndex = 0;
    for (const bucket of buckets.values()) {
      const bounds = bucket.map(integerBounds);
      const low = bounds.reduce((a, b) => a > b[0] ? a : b[0], I64_MIN);
      const high = bounds.reduce((a, b) => a < b[1] ? a : b[1], I64_MAX);
      const offset = BigInt(parseInt(digest.slice(0, 6), 16) + ++bucketIndex) * 4_096n;
      const centers = [ordinary ? 1_000_000n + offset : (1n << 62n) + offset, (1n << 53n) + offset, low, high - 4_096n];
      let replacements: string[] | undefined;
      for (const center of centers) {
        const candidates = new Map<string, string[]>();
        const start = center < low ? low : center;
        for (let step = 0; step < 4_096 && start + BigInt(step) <= high; step++) {
          const candidate = String(start + BigInt(step)); const number = String(Number(candidate));
          if (usedNumbers.has(number) || originals.has(scalarKey(candidate)) || used.has(scalarKey(candidate))) continue;
          const values = candidates.get(number) ?? []; values.push(candidate); candidates.set(number, values);
          if (values.length >= bucket.length && bucket.every((group, index) => valid(values[index], group))) { replacements = values.slice(0, bucket.length); break; }
        }
        if (replacements) break;
      }
      if (!replacements) fail('no fresh precision-preserving identifiers fit the declared signed 64-bit, format, or length bounds.');
      bucket.forEach((group, index) => { output.set(scalarKey(group.source), replacements![index]); used.add(scalarKey(replacements![index])); });
      usedNumbers.add(String(Number(replacements[0])));
    }
  }
  function generated(group: Group, attempt: number): Scalar {
    const schema = group.entries.find(entry => entry.schema.type === 'string' && entry.schema.format)?.schema ?? group.entries[0].schema;
    if (schema.type === 'null') return null;
    if (schema.type === 'boolean') return !group.source;
    if (schema.type === 'number') {
      const minimum = Math.max(...group.entries.map(entry => entry.schema.type === 'number' ? entry.schema.minimum ?? -1_000_000 : -1_000_000));
      const maximum = Math.min(...group.entries.map(entry => entry.schema.type === 'number' ? entry.schema.maximum ?? 1_000_000 : 1_000_000));
      const integer = group.entries.some(entry => entry.schema.type === 'number' && entry.schema.integer);
      const step = integer ? 1 : Math.min(1, (maximum - minimum) / 4_096);
      return (integer ? Math.ceil(minimum) : minimum) + (group.rank + attempt + 1) * step;
    }
    const code = sha256(`${digest}:${group.rank}:${attempt}`).slice(0, 20);
    const min = Math.max(...group.entries.map(entry => entry.schema.type === 'string' ? entry.schema.minLength ?? 0 : 0));
    const max = Math.min(...group.entries.map(entry => entry.schema.type === 'string' ? entry.schema.maxLength ?? CONTRACT_LIMITS.stringLength : CONTRACT_LIMITS.stringLength));
    if (schema.format === 'email') {
      const localLength = Math.max(1, Math.min(64, max - 5, Math.max(min - 5, 12)));
      return `${code.repeat(4).slice(0, localLength)}@e.co`;
    }
    if (schema.format === 'url') {
      const prefix = 'https://e.invalid/';
      return prefix + code.repeat(Math.ceil(Math.max(1, min - prefix.length) / 20)).slice(0, Math.max(0, Math.min(max - prefix.length, Math.max(8, min - prefix.length))));
    }
    if (schema.format === 'date') return new Date(Date.UTC(2031, 0, 1) + (group.rank + attempt * 2_001) * 86_400_000).toISOString().slice(0, 10);
    if (schema.format === 'date-time') {
      const value = new Date(Date.UTC(2031, 0, 1) + (group.rank + attempt * 2_001) * 1_000).toISOString();
      return max < 24 ? value.replace('.000Z', 'Z') : value;
    }
    if (schema.format === 'integer-string') {
      const [minimum] = integerBounds(group);
      return String(minimum + BigInt(group.rank + attempt + 1));
    }
    if (max < min || max === 0) return '';
    return (`s${code}`).repeat(Math.ceil(Math.max(min, 8) / 21)).slice(0, Math.min(max, Math.max(min, 8)));
  }
  function build(proposed: Map<string, Scalar>, ordinary: boolean): Map<string, Scalar> {
    const output = new Map<string, Scalar>(); const used = new Set<string>();
    if (input.profileId === 'precision') choosePrecision(output, used, ordinary);
    for (const group of groups.values()) {
      const key = scalarKey(group.source);
      if (output.has(key)) continue;
      if (isPublic(group)) { output.set(key, group.source); if (!ordinary) retainedPublicPaths.push(...group.entries.map(entry => entry.leaf.path)); continue; }
      if (group.entries.some(entry => entry.schema.type !== 'null' && entry.schema.enum)) fail('a public constant is also used at a private unconstrained path; separate its declared role before generation.');
      if (group.source === null || typeof group.source === 'boolean') { output.set(key, group.source === null ? null : !group.source); continue; }
      const proposal = proposed.get(group.entries[0].leaf.path);
      if (proposal !== undefined && available(proposal, group, used)) { output.set(key, proposal); used.add(scalarKey(proposal)); continue; }
      // Date fields use rank-based generated values so an ordered source remains ordered.
      let replacement: Scalar | undefined;
      for (let attempt = 0; attempt < 1_024; attempt++) {
        const candidate = generated(group, attempt);
        if (available(candidate, group, used)) { replacement = candidate; break; }
      }
      if (replacement === undefined) fail('no fresh private value fits all declared constraints; generation was refused.');
      output.set(key, replacement); used.add(scalarKey(replacement));
    }
    return output;
  }
  const syntheticMap = build(syntheticLeaves, false); const ordinaryMap = build(ordinaryLeaves, true);
  function apply(value: JsonValue, mapping: Map<string, Scalar>): JsonValue {
    if (Array.isArray(value)) return value.map(child => apply(child, mapping));
    if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, apply(child, mapping)]));
    return mapping.get(scalarKey(value))!;
  }
  const synthetic = apply(input.source, syntheticMap); const ordinary = apply(input.source, ordinaryMap);
  for (const payload of [synthetic, ordinary]) {
    const result = validateContractPayload(payload, contract);
    if (!result.valid) fail(`generated fixture cannot satisfy every declared constraint (${result.violations.join('; ')}); generation was refused.`);
  }
  if (retainedPublicPaths.length) disclosures.push(`${retainedPublicPaths.length} leaf value(s) retain explicitly declared public enum constants. These values are not replaced; review the public schema before sharing.`);
  disclosures.push('The contract checks only the declared bounded input rules. Application behavior, undeclared business rules, object keys, structure, equality patterns, booleans and null still require review.');
  return { synthetic, ordinary, contract, contractHash: inputContractHash(contract), retainedPublicPaths, disclosures,
    transformations: located.map(({ leaf, schema }) => ({ path: leaf.path, rule: retainedPublicPaths.includes(leaf.path) ? 'Retained an explicitly declared public enum constant' : schema.type === 'null' ? 'Retained null structural marker' : `Generated a replacement satisfying the declared ${schema.type === 'string' ? schema.format ?? 'string' : schema.type} constraints` })) };
}
