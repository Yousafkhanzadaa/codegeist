import { describe, expect, it } from 'vitest';
import { scanPayload, prepareRepro, samplePayloads } from '../../src/domain';
import { parsePayload } from '../../src/domain/json';

describe('bounded strict JSON input', () => {
  it.each([
    '{"id":9007199254740993}',
    '{"id":-9007199254740993}',
    '{"id":9.007199254740993e15}',
    '{"number":1e309}',
    '{"number":1e-400}',
    '{"number":1.0000000000000001}',
    '{"number":9007199254740991.1}',
  ])('rejects precision-losing numeric input before JSON can silently round it: %s', source => {
    expect(() => scanPayload(source)).toThrow(/numeric literal|precision/i);
  });

  it('accepts ordinary decimal data, equivalent decimal spelling and safe integers', () => {
    expect(() => scanPayload('{"a":0.1,"b":1.00,"c":1e3,"d":9007199254740991,"e":-0,"f":1e-7}')).not.toThrow();
  });

  it.each([
    '{"a":1,"a":2}',
    '{"a":1,"\\u0061":2}',
    '{"rows":[{"eventId":"a","eventId":"b"}]}',
  ])('rejects ambiguous duplicate object keys: %s', source => {
    expect(() => scanPayload(source)).toThrow(/Duplicate object keys/);
  });

  it.each(['__proto__', 'constructor', 'prototype'])('rejects prototype-related keys at any depth: %s', key => {
    const source = `{"rows":[{"${key}":{"polluted":true}}]}`;
    expect(() => scanPayload(source)).toThrow(/Prototype-related/);
    expect((Object.prototype as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it.each(['', '   ', '{', '[1,]', '{"a":01}', '{"a":NaN}', '{"a":Infinity}', '{"a":"bad\ntext"}', '{"a":"\\x20"}', 'true false'])('rejects malformed JSON without echoing raw content: %s', source => {
    expect(() => scanPayload(source)).toThrow();
  });

  it('bounds actual UTF-8 bytes, not only JavaScript string length', () => {
    expect(() => scanPayload(JSON.stringify('字'.repeat(22_000)))).toThrow(/64 KiB/);
    expect(() => scanPayload(JSON.stringify('a'.repeat(65_535)))).toThrow(/64 KiB/);
    expect(() => scanPayload(JSON.stringify('a'.repeat(65_534)))).not.toThrow();
  });

  it('stops at the node and nesting boundaries', () => {
    expect(() => scanPayload(JSON.stringify(Array(1_999).fill(0)))).not.toThrow();
    expect(() => scanPayload(JSON.stringify(Array(2_000).fill(0)))).toThrow(/2,000/);
    expect(() => scanPayload('['.repeat(20) + 'null' + ']'.repeat(20))).not.toThrow();
    expect(() => scanPayload('['.repeat(21) + 'null' + ']'.repeat(21))).toThrow(/20 levels/);
  });

  it('creates no inherited dictionary values while retaining legitimate escaped keys', () => {
    const parsed = parsePayload('{"toString":"value","a\\u0062":"other"}') as Record<string, unknown>;
    expect(Object.getPrototypeOf(parsed)).toBeNull();
    expect(parsed.toString).toBe('value');
    expect(parsed.ab).toBe('other');
  });

  it('rejects invalid preparation arguments and oversized seeds', () => {
    expect(() => prepareRepro(null as never)).toThrow(/required/);
    expect(() => prepareRepro({ sourceJson: '{}', candidateId: 'x', seed: 'x'.repeat(257) })).toThrow(/seed/);
    const candidateId = scanPayload(samplePayloads.precision.json).candidates[0].id;
    expect(() => prepareRepro({ sourceJson: samplePayloads.precision.json, candidateId, seed: '' })).not.toThrow();
  });
});
