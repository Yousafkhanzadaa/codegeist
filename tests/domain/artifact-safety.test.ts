import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareRepro, scanPayload } from '../../src/domain';
import type { InputContract, InputSchema } from '../../src/domain/input-contract';

const temporaryDirectories: string[] = [];
afterEach(() => temporaryDirectories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })));

const cases = [
  { label: 'U+2028 in a schema key', separator: '\u2028', carrier: 'key' },
  { label: 'U+2029 in a schema key', separator: '\u2029', carrier: 'key' },
  { label: 'U+2028 in a public enum', separator: '\u2028', carrier: 'enum' },
  { label: 'U+2029 in a public enum', separator: '\u2029', carrier: 'enum' },
] as const;

describe('exported harness keeps public contract declarations as data', () => {
  it.each(cases)('does not execute $label', ({ separator, carrier }) => {
    const hostileText = `metadata${separator}globalThis.__reproShareSchemaSentinel = 'executed'; //`;
    const metadataKey = carrier === 'key' ? hostileText : 'status';
    const metadataSchema: InputSchema = carrier === 'enum'
      ? { type: 'string', enum: [hostileText], public: true }
      : { type: 'string' };
    const contract: InputContract = {
      version: 1,
      schema: {
        type: 'object', additionalProperties: false, required: ['orders', metadataKey],
        properties: {
          orders: {
            type: 'array', minItems: 2, maxItems: 2,
            items: {
              type: 'object', additionalProperties: false, required: ['orderId'],
              properties: { orderId: { type: 'string', format: 'integer-string', minimum: '1000000000000000' } },
            },
          },
          [metadataKey]: metadataSchema,
        },
      },
    };
    const sourceJson = JSON.stringify({
      orders: [{ orderId: '9007199254740992' }, { orderId: '9007199254740993' }],
      [metadataKey]: carrier === 'enum' ? hostileText : 'private metadata value',
    });
    // JSON legitimately accepts both characters; filtering the input would hide the export bug.
    expect(JSON.stringify(contract)).toContain(separator);
    const candidate = scanPayload(sourceJson).candidates.find(item => item.profileId === 'precision');
    expect(candidate).toBeDefined();
    const prepared = prepareRepro({ sourceJson, candidateId: candidate!.id, seed: 'artifact-safety', inputContract: JSON.stringify(contract) });
    expect(prepared.checks.every(check => check.passed)).toBe(true);

    const prefix = '// Declared public input contract: ';
    const declarations = prepared.harnessCode.split('\n').filter(line => line.startsWith(prefix));
    expect(declarations).toHaveLength(1);
    const declaration = declarations[0].slice(prefix.length);
    expect(declaration).not.toMatch(/[\u2028\u2029]/u);
    expect(declaration).toContain(separator === '\u2028' ? '\\u2028' : '\\u2029');
    expect(JSON.parse(declaration)).toEqual(contract);
    expect(JSON.parse(declaration)).toEqual(prepared.inputContract);

    const directory = mkdtempSync(join(tmpdir(), 'reproshare-artifact-safety-'));
    temporaryDirectories.push(directory);
    writeFileSync(join(directory, 'fixture.json'), prepared.fixtureJson, 'utf8');
    writeFileSync(join(directory, 'repro.mjs'), prepared.harnessCode, 'utf8');
    writeFileSync(join(directory, 'check.mjs'), [
      "import assert from 'node:assert/strict';",
      "await import('./repro.mjs');",
      "assert.equal(globalThis.__reproShareSchemaSentinel, undefined, 'Contract data executed as JavaScript');",
      "console.log('CONTRACT_REMAINED_DATA');",
      '',
    ].join('\n'), 'utf8');
    const output = execFileSync(process.execPath, ['check.mjs'], { cwd: directory, encoding: 'utf8', timeout: 5_000, env: {} });
    expect(output).toContain('Selected condition verified');
    expect(output).toContain('CONTRACT_REMAINED_DATA');
  });
});
