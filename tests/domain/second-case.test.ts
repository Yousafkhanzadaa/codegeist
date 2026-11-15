import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertDeburrInput, DEBURR_ASSERTION_ID, DEBURR_CASE, DEBURR_FAILURE_KIND, prepareDeburrCase, scanDeburrCase } from '../../src/domain/deburr-case';
import { parsePayload } from '../../src/domain/json';
import { prepareRepro, samplePayloads, scanPayload } from '../../src/domain/index';
import { verificationInputs } from '../../src/domain/verification';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
const source = (text: string) => JSON.stringify({ text });
const prepare = (text = 'a\u20dbb', seed = 'second-real-case') => {
  const sourceJson = source(text);
  const candidate = scanDeburrCase(parsePayload(sourceJson))[0];
  return prepareDeburrCase({ sourceJson, candidateId: candidate.id, seed, applicationCaseId: 'es-toolkit-deburr' });
};
function files(text = 'a\u20dbb', seed?: string) {
  const repro = prepare(text, seed);
  const dir = mkdtempSync(join(tmpdir(), 'reproshare-second-case-'));
  dirs.push(dir);
  const harness = join(dir, 'repro.mjs');
  const fixture = join(dir, 'fixture.json');
  const original = join(dir, 'private-source.json');
  writeFileSync(harness, repro.harnessCode);
  writeFileSync(fixture, repro.fixtureJson);
  writeFileSync(original, source(text));
  return { repro, dir, harness, fixture, original };
}
function adapter(raw: string, revision = 'affected') {
  const dir = mkdtempSync(join(tmpdir(), 'reproshare-second-adapter-'));
  dirs.push(dir);
  const input = join(dir, 'input.json');
  writeFileSync(input, raw);
  return spawnSync(process.execPath, [resolve('vendor/second-case/adapter.mjs'), '--revision', revision, input], { encoding: 'utf8', timeout: 5000 });
}
describe('independent real es-toolkit combining-mark case', () => {
  it('discovers the shipped sample and prepares a bound package through the public product APIs', () => {
    const sample = samplePayloads['es-toolkit-deburr'];
    const candidate = scanPayload(sample.json).candidates.find(item => item.profileId === 'diacritics')!;
    expect(candidate).toBeDefined();
    const repro = prepareRepro({ sourceJson: sample.json, candidateId: candidate.id, seed: 'public-product-api', applicationCaseId: sample.applicationCaseId });
    expect(repro.applicationCase?.id).toBe('es-toolkit-deburr');
    expect(repro.inputContractHash).toMatch(/^[0-9a-f]{64}$/);
    const inputs = JSON.parse(verificationInputs(repro));
    expect(inputs.configurationHash).toBe(repro.configurationHash);
    expect(inputs.fixtureJson).toBe(repro.fixtureJson);
    expect(inputs.sourceHash).toBe(repro.sourceHash);
  });
  it('pins complete unchanged no-dependency modules and original MIT notices', () => {
    const provenance = JSON.parse(readFileSync('vendor/second-case/provenance.json', 'utf8'));
    expect(provenance).toMatchObject({ affectedRevision: DEBURR_CASE.affectedRevision, fixedRevision: DEBURR_CASE.proposedFixRevision, fixMerged: true, license: 'MIT', runtimeDependencies: [] });
    for (const [name, metadata] of Object.entries(provenance.files) as Array<[string, { sha256: string }]>) {
      const bytes = readFileSync('vendor/second-case/' + name);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(metadata.sha256);
      if (name.endsWith('deburr.ts')) {
        expect(bytes.toString()).not.toMatch(/\bimport\s/);
        expect(bytes.toString()).toContain('export function deburr(str: string): string');
      } else expect(bytes.toString()).toContain('Copyright (c) 2024 Viva Republica, Inc.');
    }
  });
  it('supports the public reported original and distinguishes preparation from execution', () => {
    const repro = prepare();
    expect(repro.applicationCase).toMatchObject({ id: 'es-toolkit-deburr', status: 'runner-ready' });
    expect(repro.profileId).toBe('diacritics');
    expect(repro.checks.every(check => check.passed)).toBe(true);
    expect(repro.comparison).toMatchObject({ expected: 0, source: 1, ordinary: 0, synthetic: 1, fixed: 0 });
    expect(repro).not.toHaveProperty('localVerification');
    expect(repro.reportMarkdown).toContain('No actual application result is claimed until local execution');
  });
  it('changes text and marks, retains length, produces deterministic varied fixtures', () => {
    const original = 'Private Customer\u20db\u0301-\ufe26 East';
    const one = prepare(original);
    const again = prepare(original);
    const two = prepare(original, 'different-seed');
    expect(one.fixtureJson).toBe(again.fixtureJson);
    expect(one.fixtureJson).not.toBe(two.fixtureJson);
    const text = JSON.parse(one.fixtureJson).text as string;
    expect(text).not.toBe(original);
    expect([...text]).toHaveLength([...original].length);
    for (const artifact of [one.fixtureJson, one.ordinaryJson, one.reportMarkdown, one.harnessCode]) expect(artifact).not.toContain(original);
    expect(one.reportMarkdown).not.toContain(one.sourceHash);
    expect(one.harnessCode).not.toContain(one.sourceHash);
    expect(() => assertDeburrInput(parsePayload(one.fixtureJson))).not.toThrow();
    expect(() => assertDeburrInput(parsePayload(one.ordinaryJson))).not.toThrow();
  });
  it.each([
    'a\u20dbb', 'e\ufe26i', 'Previously unseen organization\u20d1 West\ufe2f',
    'X' + Array.from({ length: 48 }, (_, i) => String.fromCodePoint(0x20d0 + i)).join('')
      + Array.from({ length: 12 }, (_, i) => String.fromCodePoint(0xfe24 + i)).join(''),
    'Z' + '\u20d0'.repeat(255),
  ])('executes generated inputs through actual affected and merged fixed entry points', text => {
    const item = files(text);
    const raw = execFileSync(process.execPath, [item.harness, item.fixture, '--source', item.original], { encoding: 'utf8', timeout: 15000, maxBuffer: 65536 });
    const proof = JSON.parse(raw);
    expect(proof).toMatchObject({ caseId: 'es-toolkit-deburr', assertionId: DEBURR_ASSERTION_ID, failureKind: DEBURR_FAILURE_KIND, sameFailureRetained: true, fixedPasses: true, sourceKind: 'provided-local-source', fixStatus: 'merged upstream fix' });
    expect(proof.results.original.affected).toMatchObject({ outcome: 'fail', failureKind: DEBURR_FAILURE_KIND });
    expect(proof.results.synthetic.affected).toEqual(proof.results.original.affected);
    expect(proof.results.ordinary.affected).toMatchObject({ outcome: 'pass' });
    for (const key of ['original', 'ordinary', 'synthetic']) expect(proof.results[key].fixed).toMatchObject({ outcome: 'pass' });
    if (text.length > 5) expect(raw).not.toContain(text);
  });
  it('runs the standalone exported harness on the public reported baseline offline', () => {
    const item = files();
    const proof = JSON.parse(execFileSync(process.execPath, [item.harness, item.fixture], { encoding: 'utf8', timeout: 15000 }));
    expect(proof.sameFailureRetained).toBe(true);
    expect(proof.sourceKind).toBe('public-upstream-reported-input');
    const inspection = JSON.parse(execFileSync(process.execPath, [item.harness, '--inspect'], { encoding: 'utf8' }));
    expect(inspection.files['affected/deburr.ts']).toMatch(/^[0-9a-f]{64}$/);
  });
  it('checks all supported ranges, including boundaries, rather than one known string', () => {
    const all = 'A' + Array.from({ length: 112 }, (_, i) => String.fromCodePoint(0x0300 + i)).join('')
      + Array.from({ length: 48 }, (_, i) => String.fromCodePoint(0x20d0 + i)).join('')
      + Array.from({ length: 16 }, (_, i) => String.fromCodePoint(0xfe20 + i)).join('');
    expect(JSON.parse(adapter(source(all)).stdout)).toMatchObject({ outcome: 'fail', failureKind: DEBURR_FAILURE_KIND });
    expect(JSON.parse(adapter(source(all), 'fixed').stdout)).toEqual({ version: 1, assertionId: DEBURR_ASSERTION_ID, outcome: 'pass' });
    expect(JSON.parse(adapter(source('ASCII only! 123')).stdout)).toMatchObject({ outcome: 'pass' });
    expect(JSON.parse(adapter('{"\\u0074ext":"x\\u20d0y"}').stdout)).toMatchObject({ outcome: 'fail' });
  });
  it.each([
    '{}', '{"text":42}', '{"text":"only ascii"}', '{"text":"\u0301"}',
    '{"text":"\ud800"}', '{"text":"\u00e9\u20d0"}', '{"text":"a\u20d0","extra":"private"}',
    source('a\u20d0' + 'x'.repeat(255)),
  ])('rejects unsupported inputs or missing trigger during preparation', raw => {
    expect(() => prepareDeburrCase({ sourceJson: raw, candidateId: scanDeburrCase(parsePayload(source('a\u20d0')))[0].id, seed: 'test' })).toThrow();
  });
  it.each([
    '{"text":"PRIVATE_SENTINEL\u20d0","text":"replacement"}',
    '{"text":"PRIVATE_SENTINEL\u20d0","extra":"private"}',
    '{"text":"PRIVATE_SENTINEL\\u0000"}',
    '{"text":false}', source('a' + 'x'.repeat(256)),
    '\v{"text":"PRIVATE_SENTINEL\u20d0"}',
  ])('rejects malformed or invalid local inputs without printing values', raw => {
    const result = adapter(raw);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).not.toContain('PRIVATE_SENTINEL');
  });
  it('refuses changed fixtures and originals that do not fail the assertion', () => {
    const item = files();
    writeFileSync(item.fixture, source('changed\u20d0'));
    const tampered = spawnSync(process.execPath, [item.harness, item.fixture], { encoding: 'utf8', timeout: 10000 });
    expect(tampered.status).not.toBe(0);
    writeFileSync(item.fixture, item.repro.fixtureJson);
    writeFileSync(item.original, source('ordinary harmless value'));
    const missing = spawnSync(process.execPath, [item.harness, item.fixture, '--source', item.original], { encoding: 'utf8', timeout: 15000 });
    expect(missing.status).not.toBe(0);
    expect(missing.stdout).not.toContain('sameFailureRetained');
    expect(missing.stderr).not.toContain('ordinary harmless value');
  });
});
