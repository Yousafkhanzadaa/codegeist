import { describe, expect, it } from 'vitest';
import { prepareRepro, scanPayload } from '../../src/domain';
import { attachLocalEvidence, canonicalJson, validateLocalEvidence, verificationInputs } from '../../src/domain/verification';
import { sha256 } from '../../src/domain/json';
import type { InputContract } from '../../src/domain/input-contract';
import type { PreparedRepro } from '../../src/shared/contracts';

const inputContract: InputContract = { version: 1, schema: { type: 'object', properties: { calls: { type: 'array', minItems: 2, items: { type: 'object', properties: { chat_id: { type: 'string', format: 'integer-string', minimum: '1000000000000000' } }, required: ['chat_id'], additionalProperties: false } } }, required: ['calls'], additionalProperties: false } };
const sourceJson = '{"calls":[{"chat_id":"9007199254740992"},{"chat_id":"9007199254740993"}]}';
function prepare(seed = 'evidence-tests'): PreparedRepro {
  return prepareRepro({ sourceJson, candidateId: scanPayload(sourceJson).candidates.find(item => item.profileId === 'precision')!.id, seed, inputContract: JSON.stringify(inputContract), verificationSpec: {
    version: 1, id: 'routing', assertionId: 'routing.exact-destination-count', failureKind: 'identity-merge',
    affected: { revision: 'affected-v1', files: [{ path: 'src/router.mjs', sha256: sha256('affected source') }] },
    fixed: { revision: 'fixed-v2', files: [{ path: 'src/router.mjs', sha256: sha256('fixed source') }] },
  } });
}
type Report = Record<string, any>;
function reportFor(repro = prepare()): Report {
  const assertionId = 'routing.exact-destination-count'; const failureKind = 'identity-merge';
  const pass = () => ({ outcome: 'pass', matchedExpected: true, assertionId });
  const failure = () => ({ outcome: 'fail', matchedExpected: true, assertionId, failureKind });
  return { version: 1, kind: 'reproshare-local-verification', sourceKind: 'provided-local-source', configurationHash: repro.configurationHash,
    contractHash: repro.inputContractHash, oracleHash: sha256('public oracle config'), sourceHash: repro.sourceHash, ordinaryHash: repro.ordinaryHash, fixtureHash: repro.fixtureHash, testSpecHash: repro.testSpecHash,
    runner: { revision: 'reproshare-local-v1', sha256: sha256('runner'), nodeVersion: 'v24.9.0' },
    adapters: { affected: { revision: 'affected-v1', files: [{ path: 'src/router.mjs', sha256: sha256('affected source') }] }, fixed: { revision: 'fixed-v2', files: [{ path: 'src/router.mjs', sha256: sha256('fixed source') }] } },
    assertionId, failureKind, inputValidity: { original: true, ordinary: true, synthetic: true },
    matrix: { original: failure(), ordinary: pass(), synthetic: failure(), fixedOriginal: pass(), fixedOrdinary: pass(), fixedSynthetic: pass() },
    verdict: 'verified', failures: [], scope: 'local-self-report-declared-files-only' };
}
function encoded(report: Report): string {
  const { evidenceHash: _oldHash, ...unsigned } = report;
  return JSON.stringify({ ...unsigned, evidenceHash: sha256(canonicalJson(unsigned)) });
}

describe('local evidence integrity and package binding', () => {
  it('accepts a complete six-cell same-assertion matrix, exports only synthetic inputs, and attaches an explicit self-report', () => {
    const repro = prepare(); const reportJson = encoded(reportFor(repro));
    expect(validateLocalEvidence(reportJson, repro).verdict).toBe('verified');
    const inputs = verificationInputs(repro);
    expect(inputs).not.toContain('9007199254740992');
    expect(inputs).not.toContain('9007199254740993');
    expect(JSON.parse(inputs).configurationHash).toBe(repro.configurationHash);
    const attached = attachLocalEvidence(repro, reportJson);
    expect(attached.localVerification?.evidenceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(attached.reportMarkdown).toContain('self-reported');
    expect(attached.reportMarkdown).toContain('did not run or remotely attest');
    expect(() => attachLocalEvidence(attached, reportJson)).toThrow(/already has a local report/);
  });

  it('rejects an edited checksum and a report from a different prepared seed/configuration', () => {
    const repro = prepare(); const report = JSON.parse(encoded(reportFor(repro)));
    report.runner.revision = 'edited-runner';
    expect(() => validateLocalEvidence(JSON.stringify(report), repro)).toThrow(/checksum/);
    expect(() => validateLocalEvidence(encoded(reportFor(repro)), prepare('other-seed'))).toThrow(/different source, fixture/);
  });

  it.each(['configurationHash', 'contractHash', 'sourceHash', 'ordinaryHash', 'fixtureHash'])('rejects an otherwise rechecksummed report with wrong %s', field => {
    const repro = prepare(); const report = reportFor(repro); report[field] = sha256(`wrong-${field}`);
    expect(() => validateLocalEvidence(encoded(report), repro)).toThrow(/different source, fixture/);
  });

  it('rejects nonzero-only crashes, unrelated failures and a fix that still fails', () => {
    const repro = prepare();
    for (const mutate of [
      (report: Report) => { report.matrix.original = { outcome: 'error', matchedExpected: true, assertionId: report.assertionId, errorCode: 'oracle-nonzero-exit' }; },
      (report: Report) => { report.matrix.synthetic.assertionId = 'unrelated.assertion'; },
      (report: Report) => { report.matrix.synthetic.failureKind = 'network-timeout'; },
      (report: Report) => { report.matrix.fixedSynthetic.outcome = 'fail'; },
      (report: Report) => { delete report.matrix.fixedOriginal; },
      (report: Report) => { report.matrix.fixedOrdinary.matchedExpected = false; },
    ]) { const report = reportFor(repro); mutate(report); expect(() => validateLocalEvidence(encoded(report), repro)).toThrow(); }
  });

  it('requires valid inputs and a verified verdict while treating the ordinary baseline as a measured control', () => {
    const repro = prepare();
    for (const mutate of [
      (report: Report) => { report.inputValidity.original = false; },
      (report: Report) => { report.verdict = 'rejected'; },
      (report: Report) => { report.failures = ['original:unexpected-outcome']; },
      (report: Report) => { report.sourceKind = 'packaged-fixture-only'; },
    ]) { const report = reportFor(repro); mutate(report); expect(() => validateLocalEvidence(encoded(report), repro)).toThrow(); }
    const control = reportFor(repro); control.matrix.ordinary = { ...control.matrix.original };
    expect(validateLocalEvidence(encoded(control), repro).ordinaryControl).toBe('preserves-failure');
  });

  it('rejects private extra fields, raw logs, commands, absolute paths and repeated declared files', () => {
    const repro = prepare(); const privateValue = 'DO-NOT-IMPORT-CUSTOMER-DATA';
    for (const mutate of [
      (report: Report) => { report.stdout = privateValue; },
      (report: Report) => { report.runner.command = ['/private/customer/project/run.sh']; },
      (report: Report) => { report.matrix.original.debug = privateValue; },
      (report: Report) => { report.adapters.affected.files[0].path = '/private/customer/source.mjs'; },
      (report: Report) => { report.adapters.fixed.files[0].path = '../customer.mjs'; },
      (report: Report) => { report.adapters.affected.files.push({ ...report.adapters.affected.files[0] }); },
    ]) {
      const report = reportFor(repro); mutate(report);
      expect(() => validateLocalEvidence(encoded(report), repro)).toThrow();
      try { validateLocalEvidence(encoded(report), repro); } catch (error) { expect(String(error)).not.toContain(privateValue); }
    }
  });

  it('refuses evidence on an uncontracted package and rejects oversized or prototype-bearing reports', () => {
    const contracted = prepare(); const withoutContract = { ...contracted, inputContract: undefined, inputContractHash: undefined };
    expect(() => verificationInputs(withoutContract)).toThrow(/Declare input requirements/);
    expect(() => validateLocalEvidence(encoded(reportFor(contracted)), withoutContract)).toThrow(/no declared input requirements/);
    expect(() => validateLocalEvidence(' '.repeat(24 * 1024 + 1), contracted)).toThrow(/at most 24 KiB/);
    expect(() => validateLocalEvidence('{"__proto__":{}}', contracted)).toThrow(/Prototype/);
  });
});
