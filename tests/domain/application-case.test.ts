import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareRepro, samplePayloads, scanPayload } from '../../src/domain/index';
import type { ApplicationCaseId, PreparedRepro } from '../../src/shared/contracts';

const CASE_ID: ApplicationCaseId = 'hermes-integer-coercion';
const SIGNED_64_MAX = (1n << 63n) - 1n;
const sample = () => samplePayloads[CASE_ID].json;
const payload = (values: unknown[]) => JSON.stringify({ calls: values.map(chat_id => ({ chat_id })) });
const temporaryDirectories: string[] = [];
afterEach(() => temporaryDirectories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })));

function precisionCandidate(sourceJson: string) {
  return scanPayload(sourceJson).candidates.find(candidate => candidate.profileId === 'precision')
    ?? scanPayload(sample()).candidates.find(candidate => candidate.profileId === 'precision')!;
}

function prepare(sourceJson = sample(), seed = 'application-case-test'): PreparedRepro {
  return prepareRepro({ sourceJson, candidateId: precisionCandidate(sourceJson).id, seed, applicationCaseId: CASE_ID });
}

function ids(sourceJson: string): string[] {
  return (JSON.parse(sourceJson) as { calls: Array<{ chat_id: string }> }).calls.map(call => call.chat_id);
}

function packageFiles(repro: PreparedRepro) {
  const directory = mkdtempSync(join(tmpdir(), 'reproshare-application-case-'));
  temporaryDirectories.push(directory);
  const harness = join(directory, 'repro.mjs');
  const fixture = join(directory, 'reproshare-operation.json');
  writeFileSync(harness, repro.harnessCode, 'utf8');
  writeFileSync(fixture, repro.fixtureJson, 'utf8');
  return { directory, harness, fixture };
}

interface AdapterResult {
  passed: boolean;
  expectedDistinct: number;
  observedDistinct: number;
  exactIntegerArguments: boolean;
  toolHandlerExecuted: boolean;
}
interface ApplicationRun {
  caseId: string;
  fixtureHash: string;
  sourceKind: string;
  assertion: string;
  sameFailureRetained: boolean;
  proposedFixPasses: boolean;
  results: Record<'original' | 'ordinary' | 'synthetic', { affected: AdapterResult; proposedFix: AdapterResult }>;
}

function execute(harness: string, fixture: string, extra: string[] = []): ApplicationRun {
  return JSON.parse(execFileSync(process.execPath, [harness, fixture, ...extra], {
    encoding: 'utf8', timeout: 60_000, maxBuffer: 1024 * 1024,
  })) as ApplicationRun;
}

describe('constrained upstream application preparation', () => {
  it('prepares a runner-ready pinned upstream case without claiming that preparation ran it', () => {
    const repro = prepare();
    expect(repro.applicationCase).toMatchObject({
      id: CASE_ID,
      status: 'runner-ready',
      affectedRevision: 'c79e3fd0baf41c0adda616b73153eeaa8a4b8231',
      proposedFixRevision: '097c9185aeb69cc302f660f1d5c8553e4fcbaedb',
      entrypoint: 'model_tools.coerce_tool_args',
      issueUrl: 'https://github.com/NousResearch/hermes-agent/issues/55314',
      fixUrl: 'https://github.com/NousResearch/hermes-agent/pull/40763',
    });
    expect(repro.applicationCase).not.toHaveProperty('sameFailureRetained');
    expect(repro.applicationCase).not.toHaveProperty('proposedFixPasses');
    expect(repro.checks.every(check => check.passed)).toBe(true);
    expect(repro.fixtureHash).toBe(createHash('sha256').update(repro.fixtureJson).digest('hex'));
  });

  it('generates canonical signed-64 IDs and safe 16-digit ordinary aliases while retaining the collision', () => {
    const repro = prepare();
    const original = ids(sample());
    const synthetic = ids(repro.fixtureJson);
    const ordinary = ids(repro.ordinaryJson);
    for (const value of synthetic) {
      expect(value).toMatch(/^[1-9]\d{15,18}$/);
      expect(BigInt(value) <= SIGNED_64_MAX).toBe(true);
      expect(original).not.toContain(value);
    }
    for (const value of ordinary) {
      expect(value).toMatch(/^[1-9]\d{15}$/);
      expect(Number.isSafeInteger(Number(value))).toBe(true);
      expect(original).not.toContain(value);
    }
    expect(new Set(synthetic).size).toBe(2);
    expect(new Set(synthetic.map(Number)).size).toBe(1);
    expect(new Set(ordinary.map(Number)).size).toBe(2);
    expect(Object.keys(JSON.parse(repro.fixtureJson))).toEqual(['calls']);
    expect(JSON.parse(repro.fixtureJson).calls.every((call: object) => JSON.stringify(Object.keys(call)) === '["chat_id"]')).toBe(true);
  });

  it('retains independent collision buckets and repeated identities across the constrained calls', () => {
    const sourceJson = payload([
      '1234567890123456789', '1234567890123456790',
      '2234567890123456789', '2234567890123456790',
      '1234567890123456789', '1000000000000001',
    ]);
    const source = ids(sourceJson);
    const generated = ids(prepare(sourceJson).fixtureJson);
    for (let left = 0; left < source.length; left++) {
      for (let right = 0; right < source.length; right++) {
        expect(generated[left] === generated[right]).toBe(source[left] === source[right]);
        expect(Number(generated[left]) === Number(generated[right])).toBe(Number(source[left]) === Number(source[right]));
      }
    }
  });

  it('accepts all 32 calls at the supported size boundary without splitting their collision bucket', () => {
    const values = Array.from({ length: 32 }, (_, index) => String(1234567890123456789n + BigInt(index)));
    const repro = prepare(payload(values));
    const generated = ids(repro.fixtureJson);
    expect(generated).toHaveLength(32);
    expect(new Set(generated).size).toBe(32);
    expect(new Set(generated.map(Number)).size).toBe(1);
    expect(repro.comparison).toMatchObject({ expected: 32, source: 1, synthetic: 1, fixed: 32 });
  });

  it('accepts the largest signed-64 source ID and keeps replacements inside that boundary', () => {
    const repro = prepare(payload([String(SIGNED_64_MAX - 1n), String(SIGNED_64_MAX)]));
    expect(ids(repro.fixtureJson).every(value => BigInt(value) <= SIGNED_64_MAX)).toBe(true);
    expect(repro.checks.every(check => check.passed)).toBe(true);
  });

  it('is repeatable for the same seed and stays within range for different seeds', () => {
    const first = prepare();
    const repeated = prepare();
    expect(repeated.fixtureJson).toEqual(first.fixtureJson);
    expect(repeated.ordinaryJson).toEqual(first.ordinaryJson);
    expect(repeated.verificationSpec).toEqual(first.verificationSpec);
    expect(repeated.bindingId).not.toBe(first.bindingId);
    const other = prepare(sample(), 'another-application-case-seed');
    expect(other.fixtureJson).not.toEqual(first.fixtureJson);
    expect(other.applicationCase).toEqual(first.applicationCase);
    expect(ids(other.fixtureJson).every(value => BigInt(value) <= SIGNED_64_MAX)).toBe(true);
  });

  it('does not copy a private local source into exported report or harness', () => {
    const privateValues = ['2345678901234567890', '2345678901234567891'];
    const repro = prepare(payload(privateValues));
    const artifacts = [repro.fixtureJson, repro.ordinaryJson, repro.reportMarkdown, repro.harnessCode].join('\n');
    for (const value of privateValues) expect(artifacts).not.toContain(value);
    expect(repro.reportMarkdown).not.toContain(repro.sourceHash);
    expect(repro.harnessCode).not.toContain(repro.sourceHash);
  });

  it('keeps the application case opt-in rather than changing generic precision preparation', () => {
    const sourceJson = sample();
    const generic = prepareRepro({ sourceJson, candidateId: precisionCandidate(sourceJson).id, seed: 'generic-still-generic' });
    expect(generic).not.toHaveProperty('applicationCase');
  });

  const validCalls = JSON.parse(sample()).calls;
  it.each([
    ['unknown top-level field', JSON.stringify({ calls: validCalls, customer: 'private-value' })],
    ['unknown call field', JSON.stringify({ calls: validCalls.map((call: object) => ({ ...call, note: 'private-value' })) })],
    ['too few calls', payload(['1234567890123456789'])],
    ['too many calls', payload(Array.from({ length: 33 }, (_, index) => index % 2 ? '1234567890123456789' : '1234567890123456790'))],
    ['negative ID', payload(['1234567890123456789', '1234567890123456790', '-1234567890123456789'])],
    ['leading-zero ID', payload(['1234567890123456789', '1234567890123456790', '01234567890123456789'])],
    ['whitespace ID', payload(['1234567890123456789', '1234567890123456790', ' 1234567890123456789'])],
    ['exponent ID', payload(['1234567890123456789', '1234567890123456790', '1e18'])],
    ['short ID', payload(['1234567890123456789', '1234567890123456790', '1001'])],
    ['20-digit ID', payload(['1234567890123456789', '1234567890123456790', '12345678901234567890'])],
    ['outside signed-64 range', payload(['1234567890123456789', '1234567890123456790', '9223372036854775808'])],
    ['numeric ID', payload(['1234567890123456789', '1234567890123456790', 9007199254740991])],
    ['non-array calls', JSON.stringify({ calls: { first: validCalls[0], second: validCalls[1] } })],
    ['nested calls', JSON.stringify({ calls: [validCalls] })],
  ])('rejects %s instead of constructing an invalid application fixture', (_label, sourceJson) => {
    expect(() => prepare(sourceJson)).toThrow();
  });

  it.each(['unicode', 'duplicates'] as const)('rejects selecting the %s profile for the precision-only application case', profile => {
    const sourceJson = samplePayloads[profile].json;
    const candidate = scanPayload(sourceJson).candidates.find(item => item.profileId === profile)!;
    expect(() => prepareRepro({ sourceJson, candidateId: candidate.id, seed: 'x', applicationCaseId: CASE_ID })).toThrow();
  });

  it('rejects unknown application-case identifiers rather than silently falling back', () => {
    expect(() => prepareRepro({ sourceJson: sample(), candidateId: precisionCandidate(sample()).id, seed: 'x', applicationCaseId: 'unknown-case' as ApplicationCaseId })).toThrow();
  });
});

describe('actual offline upstream application harness', () => {
  it('runs unchanged affected and proposed-fixed sources and retains the same actual entrypoint failure', () => {
    const repro = prepare();
    const files = packageFiles(repro);
    const result = execute(files.harness, files.fixture);
    expect(result).toMatchObject({ caseId: CASE_ID, fixtureHash: repro.fixtureHash, sameFailureRetained: true, proposedFixPasses: true });
    expect(result.sourceKind).toMatch(/public/i);
    expect(result.assertion).toMatch(/integer|exact/i);
    for (const kind of ['original', 'synthetic'] as const) {
      expect(result.results[kind].affected).toMatchObject({ passed: false, exactIntegerArguments: false, expectedDistinct: 2, observedDistinct: 1, toolHandlerExecuted: false });
      expect(result.results[kind].proposedFix).toMatchObject({ passed: true, exactIntegerArguments: true, expectedDistinct: 2, observedDistinct: 2, toolHandlerExecuted: false });
    }
    for (const revision of ['affected', 'proposedFix'] as const) {
      expect(result.results.ordinary[revision]).toMatchObject({ passed: true, exactIntegerArguments: true, expectedDistinct: 2, observedDistinct: 2, toolHandlerExecuted: false });
    }
  }, 60_000);

  it('uses an optional private local source without embedding or printing its values', () => {
    const originalValues = ['2345678901234567890', '2345678901234567891', '3345678901234567890', '3345678901234567891'];
    const sourceJson = payload(originalValues);
    const repro = prepare(sourceJson);
    const files = packageFiles(repro);
    const sourceFile = join(files.directory, 'private-local.json');
    writeFileSync(sourceFile, sourceJson, 'utf8');
    const result = execute(files.harness, files.fixture, ['--source', sourceFile]);
    expect(result.sourceKind).toMatch(/private|local/i);
    expect(result).toMatchObject({ sameFailureRetained: true, proposedFixPasses: true });
    expect(result.results.original.affected).toMatchObject({ expectedDistinct: 4, observedDistinct: 2, passed: false });
    expect(result.results.original.proposedFix).toMatchObject({ expectedDistinct: 4, observedDistinct: 4, passed: true });
    for (const value of originalValues) {
      expect(repro.harnessCode).not.toContain(value);
      expect(JSON.stringify(result)).not.toContain(value);
    }
  }, 60_000);

  it('rejects modified fixture bytes before claiming the upstream regression passed', () => {
    const repro = prepare();
    const files = packageFiles(repro);
    writeFileSync(files.fixture, repro.fixtureJson + '\n', 'utf8');
    const result = spawnSync(process.execPath, [files.harness, files.fixture], { encoding: 'utf8', timeout: 60_000 });
    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toMatch(/hash|integrity|changed|fingerprint/i);
    expect(result.stdout).not.toContain('"sameFailureRetained": true');
  }, 60_000);
});
