import { parseInputContract } from './input-contract.mjs';
import { VerificationError } from './json.mjs';

const fail = code => { throw new VerificationError(code); };
const meta = ['$schema', '$id', 'title', 'description', 'examples', 'default', 'deprecated', 'readOnly', 'writeOnly'];

/** Deliberately small JSON Schema/OpenAPI schema importer. Unsupported rules fail closed. */
export function importSchema(document, { pointer = '', publicEnums = false } = {}) {
  let value = document;
  if (typeof pointer !== 'string' || pointer.length > 512 || pointer && (!pointer.startsWith('/') || /~(?:[^01]|$)/.test(pointer))) fail('invalid-schema-pointer');
  for (const token of pointer ? pointer.slice(1).split('/') : []) {
    const key = token.replace(/~1/g, '/').replace(/~0/g, '~');
    if (['__proto__', 'prototype', 'constructor'].includes(key) || !value || typeof value !== 'object' || !Object.hasOwn(value, key)) fail('schema-pointer-unavailable');
    value = value[key];
  }
  let nodes = 0;
  function convert(schema, depth = 0) {
    if (++nodes > 128 || depth > 12 || !schema || typeof schema !== 'object' || Array.isArray(schema)) fail('unsupported-schema');
    const allowed = [...meta, 'type', 'properties', 'required', 'additionalProperties', 'items', 'minItems', 'maxItems', 'minLength', 'maxLength', 'minimum', 'maximum', 'format', 'enum', 'const'];
    if (Object.keys(schema).some(key => !allowed.includes(key))) fail('unsupported-schema-keyword');
    if (schema.enum !== undefined && schema.const !== undefined) fail('unsupported-schema-keyword');
    const type = schema.type === 'integer' ? 'number' : schema.type;
    let result;
    if (type === 'object') {
      if (schema.additionalProperties !== false || !schema.properties || typeof schema.properties !== 'object' || Array.isArray(schema.properties)) fail('closed-object-schema-required');
      result = { type, properties: Object.fromEntries(Object.entries(schema.properties).map(([key, item]) => [key, convert(item, depth + 1)])), additionalProperties: false,
        ...(schema.required !== undefined ? { required: schema.required } : {}) };
    } else if (type === 'array') result = { type, items: convert(schema.items, depth + 1), ...pick(schema, ['minItems', 'maxItems']) };
    else if (type === 'string') result = { type, ...pick(schema, ['format', 'minLength', 'maxLength', 'minimum', 'maximum']) };
    else if (type === 'number') result = { type, ...(schema.type === 'integer' ? { integer: true } : {}), ...pick(schema, ['minimum', 'maximum']) };
    else if (type === 'boolean' || type === 'null') result = { type };
    else fail('unsupported-schema-type');
    if (schema.enum !== undefined || schema.const !== undefined) {
      if (!publicEnums) fail('public-enum-review-required');
      result.enum = schema.enum ?? [schema.const];
      result.public = true;
    }
    return result;
  }
  return parseInputContract({ version: 1, schema: convert(value) });
}

function pick(value, keys) { return Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, value[key]])); }
