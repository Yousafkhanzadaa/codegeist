import { describe, expect, it } from 'vitest';
import { prepareRepro, scanPayload } from '../../src/domain';
import { attachLocalEvidence, canonicalJson, validateLocalEvidence } from '../../src/domain/verification';
import { sha256 } from '../../src/domain/json';
import type { PreparedRepro } from '../../src/shared/contracts';

const source = JSON.stringify({ text: 'a\u20dbb' });
function known() { return prepareRepro({ sourceJson: source, candidateId: scanPayload(source).candidates[0].id, applicationCaseId: 'es-toolkit-deburr' }); }
function reportFor(repro: PreparedRepro) {
  const spec = repro.verificationSpec!;
  const failure = { outcome: 'fail', matchedExpected: true, assertionId: spec.assertionId, failureKind: spec.failureKind };
  return { version: 1, kind: 'reproshare-local-verification', sourceKind: 'provided-local-source', configurationHash: repro.configurationHash,
    sourceHash: repro.sourceHash, ordinaryHash: repro.ordinaryHash, fixtureHash: repro.fixtureHash, contractHash: repro.inputContractHash,
    oracleHash: sha256('local private command configuration'), runner: { revision: 'test-fixture-v1', sha256: sha256('runner'), nodeVersion: 'v24.22.3' },
    adapters: { affected: structuredClone(spec.affected) }, assertionId: spec.assertionId, failureKind: spec.failureKind, testSpecHash: repro.testSpecHash,
    inputValidity: { original: true, ordinary: true, synthetic: true }, matrix: { original: { ...failure }, ordinary: { outcome: 'pass', matchedExpected: true, assertionId: spec.assertionId }, synthetic: { ...failure } },
    verdict: 'verified', evidenceLevel: 'failure-reproduced', ordinaryControl: 'hides-failure', repetitions: 2, failures: [], scope: 'local-self-report-declared-files-only' };
}
function encode(value: unknown) { const { evidenceHash: _, ...unsigned } = value as Record<string, unknown>; return JSON.stringify({ ...unsigned, evidenceHash: sha256(canonicalJson(unsigned)) }); }

describe('private preparation and public verification boundaries', () => {
  it('uses fresh generation entropy by default while allowing explicit private replay', () => {
    const sourceJson = JSON.stringify({ email: 'fictional7@example.test', calls: [{ chat_id: '9007199254740992' }, { chat_id: '9007199254740993' }] });
    const candidateId = scanPayload(sourceJson).candidates[0].id;
    const first = prepareRepro({ sourceJson, candidateId, seed: '' });
    const second = prepareRepro({ sourceJson, candidateId });
    expect(first.fixtureJson).not.toBe(second.fixtureJson);
    const observedAlias = JSON.parse(first.fixtureJson).email;
    const guesses = Array.from({ length: 10 }, (_, i) => {
      const guessed = sourceJson.replace('fictional7@', `fictional${i}@`);
      return JSON.parse(prepareRepro({ sourceJson: guessed, candidateId, seed: 'reproshare-1' }).fixtureJson).email;
    });
    expect(guesses).not.toContain(observedAlias);
    const replay = () => prepareRepro({ sourceJson, candidateId, seed: 'private-replay-only' });
    expect(replay().fixtureJson).toBe(replay().fixtureJson);
  });

  it('accepts the unfixed known case and publishes only a separately checksummed public projection', () => {
    const repro = known(); const privateReport = reportFor(repro); const encoded = encode(privateReport);
    expect(validateLocalEvidence(encoded, repro).evidenceLevel).toBe('failure-reproduced');
    const attached = attachLocalEvidence(repro, encoded);
    const publicArtifacts = JSON.stringify({ report: attached.reportMarkdown, runner: attached.harnessCode, receipt: attached.publicVerification });
    for (const fingerprint of [repro.sourceHash, repro.configurationHash, privateReport.oracleHash, JSON.parse(encoded).evidenceHash]) expect(publicArtifacts).not.toContain(fingerprint);
    const { evidenceHash, ...projection } = attached.publicVerification!;
    expect(evidenceHash).toBe(sha256(canonicalJson(projection)));
    expect(attached.localVerification?.sourceHash).toBe(repro.sourceHash);
    expect(attached.reportMarkdown).toContain('fix pending');
    expect(() => validateLocalEvidence(JSON.stringify(attached.localVerification), attached)).not.toThrow();
  });

  it('rejects an unrelated assertion and unrelated critical files even with a recomputed checksum', () => {
    const repro = known();
    const wrongTest = reportFor(repro);
    wrongTest.assertionId = 'unrelated.assertion';
    wrongTest.matrix.original.assertionId = wrongTest.assertionId; wrongTest.matrix.synthetic.assertionId = wrongTest.assertionId;
    expect(() => validateLocalEvidence(encode(wrongTest), repro)).toThrow(/predeclared/);
    const wrongFiles = reportFor(repro);
    wrongFiles.adapters.affected.files = [{ path: 'unrelated.mjs', sha256: '0'.repeat(64) }];
    expect(() => validateLocalEvidence(encode(wrongFiles), repro)).toThrow(/predeclared/);
  });

  it('never upgrades a pre-fix matrix to fix validated without the declared fixed cells', () => {
    const repro = known(); const report = reportFor(repro); report.evidenceLevel = 'fix-validated';
    expect(() => validateLocalEvidence(encode(report), repro)).toThrow(/evidence level/);
  });
});
