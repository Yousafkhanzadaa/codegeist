import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareRepro, samplePayloads, scanPayload } from '../../src/domain/index';
import type { ApplicationCaseId } from '../../src/shared/contracts';
import { runVerification } from '../../local/protocol.mjs';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });

describe('same reusable local protocol against independent pinned applications', () => {
  it.each([
    { caseId: 'hermes-integer-coercion' as ApplicationCaseId, source: samplePayloads['hermes-integer-coercion'].json, profile: 'precision', oracle: 'vendor/hermes/oracle.json' },
    { caseId: 'es-toolkit-deburr' as ApplicationCaseId, source: JSON.stringify({ text: 'a\u20dbb' }), profile: 'diacritics', oracle: 'vendor/second-case/oracle.json' },
  ])('verifies actual ReproShare output with $caseId without publishing original values', async example => {
    const candidate = scanPayload(example.source).candidates.find(item => item.profileId === example.profile)!;
    const prepared = prepareRepro({ sourceJson: example.source, candidateId: candidate.id, seed: 'generic-local-oracle-integration', applicationCaseId: example.caseId });
    expect(prepared.inputContract).toBeDefined();
    const directory = await mkdtemp(join(tmpdir(), 'reproshare-real-oracle-test-'));
    directories.push(directory);
    const sourcePath = join(directory, 'source.json');
    const packagePath = join(directory, 'verification-inputs.json');
    await writeFile(sourcePath, example.source, { mode: 0o600 });
    await writeFile(packagePath, JSON.stringify({
      version: 1, kind: 'reproshare-verification-inputs', configurationHash: prepared.configurationHash,
      sourceHash: prepared.sourceHash, ordinaryHash: prepared.ordinaryHash, fixtureHash: prepared.fixtureHash,
      inputContractHash: prepared.inputContractHash, ordinaryJson: prepared.ordinaryJson, fixtureJson: prepared.fixtureJson,
      inputContract: prepared.inputContract,
    }));
    const report = await runVerification({ packagePath, sourcePath, oraclePath: resolve(example.oracle), cwd: resolve('.'), allowCommand: true });
    expect(report.verdict, JSON.stringify(report.failures)).toBe('verified');
    expect(report.matrix.original?.outcome).toBe('fail');
    expect(report.matrix.ordinary?.outcome).toBe('pass');
    expect(report.matrix.synthetic?.outcome).toBe('fail');
    expect(report.matrix.synthetic?.failureKind).toBe(report.matrix.original?.failureKind);
    expect(report.matrix.fixedOriginal?.outcome).toBe('pass');
    expect(report.matrix.fixedOrdinary?.outcome).toBe('pass');
    expect(report.matrix.fixedSynthetic?.outcome).toBe('pass');
    expect(JSON.stringify(report)).not.toContain(JSON.parse(example.source).calls?.[0]?.chat_id ?? JSON.parse(example.source).text);
  });
});
