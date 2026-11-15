import { describe, expect, it } from 'vitest';
import { canonicalInputContract, constrainFixtures, inputContractHash, parseInputContract, validateContractPayload, type InputContract, type InputSchema } from '../../src/domain/input-contract';
import { leavesOf, mapLeaves, parsePayload, type JsonValue } from '../../src/domain/json';
import { prepareRepro, scanPayload } from '../../src/domain';

const object = (properties: Record<string, InputSchema>, required = Object.keys(properties)): InputSchema => ({ type: 'object', properties, required, additionalProperties: false });
const ids: InputSchema = { type: 'string', format: 'integer-string', minimum: '1000000000000000', maximum: '9223372036854775807', minLength: 16, maxLength: 19 };
const source: JsonValue = {
  calls: [{ chat_id: '9007199254740992' }, { chat_id: '9007199254740993' }],
  email: 'private.customer@secret.test', confirmation: 'private.customer@secret.test',
  started: '2026-02-20', finished: '2026-02-21', quantity: 7, status: 'pending', active: true,
};
const contract: InputContract = {
  version: 1,
  schema: object({
    calls: { type: 'array', minItems: 2, maxItems: 8, items: object({ chat_id: ids }) },
    email: { type: 'string', format: 'email', minLength: 20, maxLength: 64 },
    confirmation: { type: 'string', format: 'email', minLength: 20, maxLength: 64 },
    started: { type: 'string', format: 'date' }, finished: { type: 'string', format: 'date' },
    quantity: { type: 'number', integer: true, minimum: 1, maximum: 100 },
    status: { type: 'string', enum: ['pending', 'accepted'], public: true }, active: { type: 'boolean' },
  }),
  relations: [
    { left: '/email', operator: 'eq', right: '/confirmation' },
    { left: '/started', operator: 'lt', right: '/finished' },
  ],
};

function generate(payload = source, rules = contract, seed = 'bounded-contract-test') {
  const proposal = mapLeaves(payload, value => typeof value === 'string' ? 'generic-alias' : typeof value === 'number' ? -999 : typeof value === 'boolean' ? !value : null);
  return constrainFixtures({ source: payload, synthetic: proposal, ordinary: proposal, contract: rules, profileId: 'precision', selectedPaths: ['$.calls[0].chat_id', '$.calls[1].chat_id'], seed });
}

describe('bounded public input contracts', () => {
  it('integrates the contract into a complete prepared package with real formats and public constants', () => {
    const { quantity: _quantity, ...properties } = (contract.schema as Extract<InputSchema, { type: 'object' }>).properties;
    const integratedContract: InputContract = { ...contract, schema: object({ ...properties, amount: { type: 'number', minimum: 1, maximum: 100, integer: true } }) };
    const payload: Record<string, JsonValue> = { ...source as Record<string, JsonValue>, amount: 14 };
    delete payload.quantity;
    const sourceJson = JSON.stringify(payload);
    const candidate = scanPayload(sourceJson).candidates.find(item => item.profileId === 'precision');
    expect(candidate).toBeDefined();
    const prepared = prepareRepro({ sourceJson, candidateId: candidate!.id, seed: 'integrated-contract', inputContract: JSON.stringify(integratedContract) });
    expect(prepared.checks.every(check => check.passed)).toBe(true);
    expect(prepared.checks.find(check => check.id === 'input-validity')?.passed).toBe(true);
    expect(prepared.checks.find(check => check.id === 'values')?.label).toContain('Private');
    expect(prepared.inputContractHash).toBe(inputContractHash(integratedContract));
    expect(prepared.configurationHash).toMatch(/^[a-f0-9]{64}$/);
    const synthetic = parsePayload(prepared.fixtureJson);
    const ordinary = parsePayload(prepared.ordinaryJson);
    expect(validateContractPayload(synthetic, integratedContract).valid).toBe(true);
    expect(validateContractPayload(ordinary, integratedContract).valid).toBe(true);
    const originalPrivateValues = new Set(leavesOf(payload).filter(leaf => leaf.path !== '$.status').map(leaf => leaf.value));
    expect(leavesOf(synthetic).filter(leaf => typeof leaf.value === 'string' || typeof leaf.value === 'number').every(leaf => leaf.path === '$.status' || !originalPrivateValues.has(leaf.value))).toBe(true);
    expect((synthetic as Record<string, JsonValue>).amount).toBeGreaterThanOrEqual(1);
    expect(prepared.limits.join(' ')).toContain('not replaced');
    expect(prepared.reportMarkdown).toContain('public enum');
    expect(prepared.comparison.synthetic).toBe(prepared.comparison.source);
    expect(prepared.comparison.ordinary).toBe(prepared.comparison.expected);
  });

  it('keeps a signed64 collision, valid dates/email/ranges, declared equality and order while replacing private values', () => {
    const result = generate();
    expect(validateContractPayload(result.synthetic, contract)).toEqual({ valid: true, violations: [] });
    expect(validateContractPayload(result.ordinary, contract)).toEqual({ valid: true, violations: [] });
    const fixture = result.synthetic as Record<string, JsonValue>;
    const calls = fixture.calls as Array<Record<string, string>>;
    const ordinary = (result.ordinary as Record<string, JsonValue>).calls as Array<Record<string, string>>;
    expect(calls[0].chat_id).not.toBe(calls[1].chat_id);
    expect(Number(calls[0].chat_id)).toBe(Number(calls[1].chat_id));
    expect(Number(ordinary[0].chat_id)).not.toBe(Number(ordinary[1].chat_id));
    expect(calls.every(call => BigInt(call.chat_id) <= 9223372036854775807n)).toBe(true);
    expect(fixture.email).toBe(fixture.confirmation);
    expect(Date.parse(String(fixture.started))).toBeLessThan(Date.parse(String(fixture.finished)));
    expect(fixture.quantity).toBeGreaterThanOrEqual(1);
    const originals = new Set(leavesOf(source).filter(leaf => ['string', 'number'].includes(typeof leaf.value) && leaf.path !== '$.status').map(leaf => leaf.value));
    expect(leavesOf(result.synthetic).filter(leaf => leaf.path !== '$.status').every(leaf => !originals.has(leaf.value))).toBe(true);
    expect(result.retainedPublicPaths).toEqual(['$.status']);
    expect(result.disclosures.join(' ')).toContain('not replaced');
    expect(fixture.status).toBe('pending');
    expect(generate().synthetic).toEqual(result.synthetic);
    expect(generate(source, contract, 'different-seed').synthetic).not.toEqual(result.synthetic);
  });

  it('hashes canonical key order while keeping every declared rule in the hash', () => {
    const reordered = { schema: contract.schema, relations: contract.relations, version: 1 } as InputContract;
    expect(canonicalInputContract(reordered)).toBe(canonicalInputContract(contract));
    expect(inputContractHash(reordered)).toBe(inputContractHash(contract));
    const changed = JSON.parse(JSON.stringify(contract)) as InputContract;
    changed.relations = [];
    expect(inputContractHash(changed)).not.toBe(inputContractHash(contract));
  });

  it('refuses impossible fresh precision replacements in a range containing only the original identifiers', () => {
    const narrow: InputContract = { version: 1, schema: object({ calls: { type: 'array', items: object({ chat_id: { type: 'string', format: 'integer-string', minimum: '9007199254740992', maximum: '9007199254740993' } }) } }) };
    expect(() => generate({ calls: (source as Record<string, JsonValue>).calls }, narrow)).toThrow(/no fresh precision-preserving/);
  });

  it('refuses a private constant with no alternative rather than copying it', () => {
    const rules: InputContract = { version: 1, schema: object({ calls: { type: 'array', items: object({ chat_id: ids }) }, note: { type: 'string', maxLength: 0 } }) };
    expect(() => generate({ calls: (source as Record<string, JsonValue>).calls, note: '' }, rules)).toThrow(/no fresh private value/);
  });

  it('refuses undeclared properties, missing required keys, invalid source formats and false crossfield relations', () => {
    expect(validateContractPayload({ ...source as object, surprise: true } as JsonValue, contract).valid).toBe(false);
    const missing = { ...source as Record<string, JsonValue> }; delete missing.quantity;
    expect(validateContractPayload(missing, contract).valid).toBe(false);
    for (const changed of [{ email: 'not-an-email' }, { started: '2026-02-30' }, { finished: '2026-02-19' }, { quantity: 0 }]) {
      const value = { ...source as object, ...changed } as unknown as JsonValue;
      expect(validateContractPayload(value, contract).valid).toBe(false);
      expect(() => generate(value)).toThrow(/source payload is invalid/);
    }
  });

  it('checks integer strings exactly rather than coercing their 64-bit bounds to Number', () => {
    const rules: InputContract = { version: 1, schema: { type: 'string', format: 'integer-string', maximum: '9223372036854775806' } };
    expect(validateContractPayload('9223372036854775806', rules).valid).toBe(true);
    expect(validateContractPayload('9223372036854775807', rules).valid).toBe(false);
    expect(validateContractPayload('9223372036854775808', rules).valid).toBe(false);
    expect(validateContractPayload('01', rules).valid).toBe(false);
    expect(validateContractPayload('-0', rules).valid).toBe(false);
    expect(validateContractPayload('-9223372036854775808', rules).valid).toBe(true);
    const ordered: InputContract = { version: 1, schema: object({ left: { type: 'string', format: 'integer-string' }, right: { type: 'string', format: 'integer-string' } }), relations: [{ left: '/left', operator: 'lt', right: '/right' }] };
    expect(Number('9223372036854775806')).toBe(Number('9223372036854775807'));
    expect(validateContractPayload({ left: '9223372036854775806', right: '9223372036854775807' }, ordered).valid).toBe(true);
    expect(validateContractPayload({ right: '9223372036854775806', left: '9223372036854775807' }, ordered).valid).toBe(false);
  });

  it('defines real UTC dates/times and HTTPS URLs without interpreting arbitrary regex', () => {
    for (const [format, good, bad] of [
      ['date', '2024-02-29', '2025-02-29'],
      ['date-time', '2026-01-01T12:34:56Z', '2026-01-01T25:34:56Z'],
      ['url', 'https://example.invalid/path', 'https://user:password@example.invalid/'],
    ] as const) {
      const rules: InputContract = { version: 1, schema: { type: 'string', format } };
      expect(validateContractPayload(good, rules).valid).toBe(true);
      expect(validateContractPayload(bad, rules).valid).toBe(false);
    }
  });

  it('requires enums to be explicitly public and rejects invalid or inconsistent bounds', () => {
    for (const schema of [
      { type: 'string', enum: ['secret'] },
      { type: 'string', enum: ['bad'], public: true, format: 'email' },
      { type: 'string', public: true },
      { type: 'string', minLength: 10, maxLength: 2 },
      { type: 'string', format: 'integer-string', minimum: '9223372036854775808' },
      { type: 'number', minimum: 5, maximum: 2 },
      { type: 'array', items: { type: 'null' }, minItems: 3, maxItems: 1 },
    ]) expect(() => parseInputContract({ version: 1, schema })).toThrow();
  });

  it('rejects unsupported keywords, malformed pointers, duplicate/prototype keys and accessor code without running it', () => {
    for (const value of [
      { version: 1, schema: { type: 'string', pattern: '(a+)+$' } },
      { version: 1, schema: object({}), relations: [{ left: '/a/*', right: '/b', operator: 'eq' }] },
      { version: 1, schema: object({}), relations: [{ left: '/a~2', right: '/b', operator: 'eq' }] },
      { version: 1, schema: Object.create({ type: 'string' }) },
    ]) expect(() => parseInputContract(value)).toThrow();
    expect(() => parseInputContract('{"version":1,"version":1,"schema":{"type":"string"}}')).toThrow(/Duplicate/);
    expect(() => parseInputContract('{"version":1,"schema":{"type":"object","properties":{"__proto__":{"type":"string"}},"additionalProperties":false}}')).toThrow(/Prototype/);
    let invoked = false;
    const accessor = Object.defineProperty({}, 'version', { enumerable: true, get() { invoked = true; return 1; } });
    expect(() => parseInputContract(accessor)).toThrow();
    expect(invoked).toBe(false);
  });

  it('caps complexity and does not leak failing private scalar values in diagnostics', () => {
    const huge = Array.from({ length: 2_001 }, () => ({ type: 'string' }));
    expect(() => parseInputContract({ version: 1, schema: huge })).toThrow();
    const privateValue = 'NEVER-LOG-THIS-CUSTOMER-TOKEN';
    const result = validateContractPayload(privateValue, { version: 1, schema: { type: 'string', format: 'email' } });
    expect(JSON.stringify(result)).not.toContain(privateValue);
    expect(() => parseInputContract(parsePayload('{"version":1,"schema":{"type":"string","pattern":"x"}}'))).toThrow(/unsupported keyword/);
    const sparse = new Array(1);
    expect(() => parseInputContract({ version: 1, schema: { type: 'string', public: true, enum: sparse } })).toThrow(/sparse/);
  });
});
