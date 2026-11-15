import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareRepro, samplePayloads, scanPayload } from '../../src/domain';
import { leavesOf, parsePayload, type JsonValue } from '../../src/domain/json';
import type { PreparedRepro, ProfileId } from '../../src/shared/contracts';
type PatternProfile = Exclude<ProfileId, 'diacritics' | 'application'>;

const temporaryDirectories: string[] = [];
afterEach(() => temporaryDirectories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })));

function prepared(profile: PatternProfile, json = samplePayloads[profile].json, seed = 'test-seed'): PreparedRepro {
  const candidate = scanPayload(json).candidates.find(item => item.profileId === profile);
  expect(candidate, `A ${profile} condition should be discoverable`).toBeDefined();
  return prepareRepro({ sourceJson: json, candidateId: candidate!.id, seed });
}

function selected(root: unknown, field: string): string[] {
  return leavesOf(root as JsonValue).filter(leaf => leaf.fieldName === field).map(leaf => leaf.value as string);
}

function packageDirectory(repro: PreparedRepro, fixtureName = 'fixture.json'): string {
  const directory = mkdtempSync(join(tmpdir(), 'reproshare-domain-'));
  temporaryDirectories.push(directory);
  writeFileSync(join(directory, 'repro.mjs'), repro.harnessCode, 'utf8');
  writeFileSync(join(directory, fixtureName), repro.fixtureJson, 'utf8');
  return directory;
}

describe('supported-condition discovery', () => {
  it.each(['precision', 'unicode', 'duplicates'] as PatternProfile[])('finds the %s sample without diagnosing the customer app', profile => {
    const sample = samplePayloads[profile];
    const result = scanPayload(sample.json);
    expect(result.candidates.some(candidate => candidate.profileId === profile)).toBe(true);
    expect(result.sourceHash).toBe(createHash('sha256').update(sample.json).digest('hex'));
    expect(result.warnings.join(' ')).toContain('not a diagnosis');
    expect(result.candidates).toEqual(scanPayload(sample.json).candidates);
  });

  it('does not join unrelated identifier namespaces merely because their field names match', () => {
    const result = scanPayload(JSON.stringify({
      orders: [{ id: '9007199254740992' }],
      employees: [{ id: '9007199254740993' }],
    }));
    expect(result.candidates).toEqual([]);
  });

  it('does not interpret repeated status or customer strings as duplicate event deliveries', () => {
    const result = scanPayload(JSON.stringify({ events: [
      { eventId: 'evt-1', customerId: 'customer-1', status: 'pending' },
      { eventId: 'evt-2', customerId: 'customer-1', status: 'pending' },
    ] }));
    expect(result.candidates).toEqual([]);
  });

  it('returns an explicit unsupported outcome for ordinary JSON, scalars, and empty containers', () => {
    for (const json of ['{}', '[]', 'null', '42', '{"note":"ordinary text"}']) {
      const result = scanPayload(json);
      expect(result.candidates).toEqual([]);
      expect(result.warnings[0]).toContain('No supported condition');
    }
  });

  it('exposes paths and counts rather than original identifier values in discovery', () => {
    const source = samplePayloads.precision.json;
    const serialized = JSON.stringify(scanPayload(source));
    expect(serialized).toContain('$.orders[0].orderId');
    expect(serialized).not.toContain('9007199254740992');
    expect(serialized).not.toContain('maya@fictional-customer.example');
  });

  it('does not accept an unrelated or removed candidate', () => {
    const candidate = scanPayload(samplePayloads.precision.json).candidates[0];
    expect(() => prepareRepro({ sourceJson: '{"orders":[]}', candidateId: candidate.id, seed: 'x' })).toThrow(/no longer present/);
    expect(() => prepareRepro({ sourceJson: samplePayloads.precision.json, candidateId: '__proto__', seed: 'x' })).toThrow(/no longer present/);
  });
});

describe('synthetic reproduction', () => {
  it('replaces long private IDs while preserving actual Number collisions', () => {
    const repro = prepared('precision');
    const fixture = JSON.parse(repro.fixtureJson);
    const values = selected(fixture, 'orderId');
    expect(new Set(values).size).toBe(2);
    expect(new Set(values.map(Number)).size).toBe(1);
    expect(values).not.toContain('9007199254740992');
    expect(repro.comparison).toMatchObject({ expected: 2, source: 1, ordinary: 2, synthetic: 1, fixed: 2 });
    expect(repro.checks.every(check => check.passed)).toBe(true);
  });

  it('preserves multiple independent collision buckets and repeated exact identities', () => {
    const source = JSON.stringify({ orders: [
      { orderId: '9007199254740992' }, { orderId: '9007199254740993' },
      { orderId: '18014398509481984' }, { orderId: '18014398509481985' },
      { orderId: '42' }, { orderId: '42' },
    ] });
    const repro = prepared('precision', source);
    expect(repro.comparison).toMatchObject({ expected: 5, source: 3, ordinary: 5, synthetic: 3, fixed: 5 });
    const original = selected(JSON.parse(source), 'orderId');
    const synthetic = selected(JSON.parse(repro.fixtureJson), 'orderId');
    original.forEach((left, index) => original.forEach((right, other) => {
      expect(synthetic[index] === synthetic[other]).toBe(left === right);
      expect(Number(synthetic[index]) === Number(synthetic[other])).toBe(Number(left) === Number(right));
    }));
  });

  it('handles negative numeric-string identities and zero spelling collisions', () => {
    const source = JSON.stringify({ records: [
      { recordId: '-9007199254740992' }, { recordId: '-9007199254740993' },
      { recordId: '-0' }, { recordId: '0' },
    ] });
    expect(prepared('precision', source).comparison).toMatchObject({ expected: 4, source: 2, synthetic: 2, fixed: 4 });
  });

  it('changes Unicode identifiers without normalizing away the selected failure', () => {
    const repro = prepared('unicode');
    const values = selected(JSON.parse(repro.fixtureJson), 'externalId');
    expect(new Set(values).size).toBe(2);
    expect(new Set(values.map(value => value.normalize('NFC'))).size).toBe(1);
    expect(repro.fixtureJson).not.toContain('client-caf');
    expect(repro.comparison).toMatchObject({ expected: 2, source: 1, ordinary: 2, synthetic: 1, fixed: 2 });
    expect(repro.limits.join(' ')).toContain('Other business meanings');
  });

  it('supports more than two canonically equivalent values without creating new exact equality', () => {
    const source = JSON.stringify({ records: [
      { externalId: '\u00e9\u00e9' }, { externalId: 'e\u0301\u00e9' },
      { externalId: '\u00e9e\u0301' }, { externalId: 'e\u0301e\u0301' },
      { externalId: 'different-key' },
    ] });
    const repro = prepared('unicode', source);
    expect(repro.comparison).toMatchObject({ expected: 5, source: 2, ordinary: 5, synthetic: 2, fixed: 5 });
  });

  it('honestly reports that ordinary consistent aliases preserve repeated event IDs too', () => {
    const repro = prepared('duplicates');
    const values = selected(JSON.parse(repro.fixtureJson), 'eventId');
    expect(values[0]).toBe(values[1]);
    expect(values[2]).not.toBe(values[1]);
    expect(repro.comparison).toMatchObject({ expected: 2, source: 3, ordinary: 3, synthetic: 3, fixed: 2 });
    expect(repro.reportMarkdown).toContain('Ordinary consistent aliases also preserve repeated IDs');
    expect(repro.checks.find(check => check.id === 'baseline')!.detail).toContain('also preserve');
  });

  it('retains string equality across fields while replacing all original string/number leaves', () => {
    const source = samplePayloads.precision.json;
    const repro = prepared('precision');
    const fixture = JSON.parse(repro.fixtureJson);
    expect(fixture.orders[0].tenantId).toBe(fixture.orders[1].tenantId);
    const originalLeaves = leavesOf(parsePayload(source));
    const generatedLeaves = leavesOf(parsePayload(repro.fixtureJson));
    const originalStrings = new Set(originalLeaves.filter(leaf => typeof leaf.value === 'string').map(leaf => leaf.value));
    const originalNumbers = new Set(originalLeaves.filter(leaf => typeof leaf.value === 'number').map(leaf => leaf.value));
    for (const leaf of generatedLeaves) {
      if (typeof leaf.value === 'string') expect(originalStrings.has(leaf.value)).toBe(false);
      if (typeof leaf.value === 'number') expect(originalNumbers.has(leaf.value)).toBe(false);
    }
    expect(fixture.enabled).toBe(false);
    expect(fixture.cursor).toBeNull();
    expect(repro.changedValueCount).toBe(originalLeaves.filter(leaf => leaf.value !== null).length);
  });

  it.each(['precision', 'unicode', 'duplicates'] as PatternProfile[])('keeps private sample strings out of every exported %s artifact', profile => {
    const repro = prepared(profile);
    const output = [repro.fixtureJson, repro.ordinaryJson, repro.reportMarkdown, repro.harnessCode].join('\n');
    const originals = leavesOf(parsePayload(samplePayloads[profile].json)).filter(leaf => typeof leaf.value === 'string');
    for (const leaf of originals) expect(output).not.toContain(leaf.value as string);
    expect(output).not.toContain('test-seed');
    expect(repro.reportMarkdown).not.toContain(repro.sourceHash);
    expect(repro.harnessCode).not.toContain(repro.sourceHash);
  });

  it('is reproducible for a fixed source/candidate/seed and changes synthetic values for a new seed', () => {
    const first = prepared('precision', undefined, 'repeatable');
    const second = prepared('precision', undefined, 'repeatable');
    const other = prepared('precision', undefined, 'another-seed');
    expect(second.fixtureJson).toEqual(first.fixtureJson);
    expect(second.ordinaryJson).toEqual(first.ordinaryJson);
    expect(second.bindingId).not.toBe(first.bindingId);
    expect(other.fixtureJson).not.toEqual(first.fixtureJson);
    expect(other.sourceHash).toBe(first.sourceHash);
    expect(other.fixtureHash).not.toBe(first.fixtureHash);
    expect(other.comparison).toEqual(first.comparison);
  });

  it('hashes exact source and fixture bytes, rather than an unspecified normalized version', () => {
    const first = prepared('precision');
    const whitespaceChanged = prepared('precision', samplePayloads.precision.json + '\n');
    expect(first.sourceHash).not.toBe(whitespaceChanged.sourceHash);
    expect(first.fixtureHash).toBe(createHash('sha256').update(first.fixtureJson).digest('hex'));
  });
});

describe('standalone exported harness', () => {
  it.each(['precision', 'unicode', 'duplicates'] as PatternProfile[])('runs the actual %s fixture and its fixed example with no third-party packages', profile => {
    const repro = prepared(profile);
    const directory = packageDirectory(repro);
    const result = JSON.parse(execFileSync(process.execPath, [join(directory, 'repro.mjs')], { cwd: directory, encoding: 'utf8' }));
    expect(result.synthetic).toBe(repro.comparison.synthetic);
    expect(result.fixed).toBe(repro.comparison.expected);
    expect(result.ordinary).toBe(repro.comparison.ordinary);
    expect(result.result).toContain('customer application not executed');
  });

  it('accepts an operation-specific filename and detects any altered fixture bytes', () => {
    const repro = prepared('precision');
    const directory = packageDirectory(repro, 'repro-operation-001.json');
    const path = join(directory, 'repro-operation-001.json');
    expect(() => execFileSync(process.execPath, [join(directory, 'repro.mjs'), path], { encoding: 'utf8' })).not.toThrow();
    writeFileSync(path, readFileSync(path, 'utf8') + '\n');
    const tampered = spawnSync(process.execPath, [join(directory, 'repro.mjs'), path], { encoding: 'utf8' });
    expect(tampered.status).not.toBe(0);
    expect(tampered.stderr).toContain('Fixture hash differs');
  });

  it('treats hostile source strings and path keys as data, not executable harness code', () => {
    const suspiciousKey = 'x"]; console.log("INJECTED_CODE"); // `|<script>';
    const source = JSON.stringify({ [suspiciousKey]: { records: [
      { recordId: '9007199254740992', note: '${process.exit(91)} private-canary-3571' },
      { recordId: '9007199254740993', note: 'another-private-canary-3572' },
    ] } });
    const repro = prepared('precision', source);
    expect(repro.harnessCode).not.toContain('private-canary');
    const directory = packageDirectory(repro);
    const output = execFileSync(process.execPath, [join(directory, 'repro.mjs')], { cwd: directory, encoding: 'utf8' });
    expect(() => JSON.parse(output)).not.toThrow();
    expect(output).not.toContain('INJECTED_CODE');
  });
});
