import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { prepareLocalWorkflow } from '../../src/domain/local-workflow';
import { canonicalJson, publicVerificationEvidence } from '../../src/domain/verification';
import { evidenceHash, sha256 } from '../../local/protocol.mjs';
import { renderPortableRunner } from '../../local/portable-template.mjs';
import { reproDescription } from '../../src/server/adf';

async function actualPackage() {
  return JSON.parse(await readFile(resolve('tests/fixtures/application-workflow-review.json'), 'utf8'));
}
function manifestFrom(runner: string) {
  const marker = 'const packageData = ';
  const begin = runner.indexOf(marker) + marker.length;
  return JSON.parse(runner.slice(begin, runner.indexOf(';\nconst hash =', begin)));
}

describe('actual CLI application-workflow import', () => {
  it('accepts the real HTTP application package as reproduced with fix pending, preserving private binding privately', async () => {
    const packet = await actualPackage();
    const prepared = prepareLocalWorkflow(JSON.stringify(packet));
    expect(prepared.profileId).toBe('application');
    expect(prepared.verificationSpec?.id).toBe('heldout-invoice-import-v1');
    expect(prepared.localVerification?.sourceHash).toBe(packet.report.sourceHash);
    expect(prepared.publicVerification?.evidenceLevel).toBe('failure-reproduced');
    expect(prepared.publicVerification?.adapters.fixed).toBeUndefined();
    expect(prepared.harnessCode).toContain('portable APPLICATION assertion');
    expect(prepared.workflowSummary?.removedParts).toBeGreaterThan(0);
  });

  it('publishes only a public receipt, excluding source/configuration/command/private-report commitments from all recipient content', async () => {
    const packet = await actualPackage();
    const prepared = prepareLocalWorkflow(JSON.stringify(packet));
    const publicParts = JSON.stringify({ markdown: prepared.reportMarkdown, runner: prepared.harnessCode, receipt: prepared.publicVerification,
      issue: reproDescription(prepared, { fixture: 'fixture.json', harness: 'application-reproducer.mjs' }), limits: prepared.limits });
    for (const key of ['sourceHash', 'configurationHash', 'oracleHash', 'evidenceHash']) expect(publicParts, key).not.toContain(packet.report[key]);
    expect(prepared.publicVerification).not.toHaveProperty('sourceHash');
    expect(prepared.publicVerification).not.toHaveProperty('configurationHash');
    expect(prepared.publicVerification).not.toHaveProperty('oracleHash');
    const receipt = publicVerificationEvidence(prepared.localVerification!, prepared.bindingId!);
    const { evidenceHash: checksum, ...unsigned } = receipt;
    expect(checksum).toBe(sha256(canonicalJson(unsigned)));
    expect(checksum).not.toBe(packet.report.evidenceHash);
    expect(publicParts).not.toContain('alpha.one@example.test');
    expect(publicParts).not.toContain('Fictional alpha One');
  });

  it('rejects a different assertion even when the report is internally consistent and its checksum was recomputed', async () => {
    const packet = await actualPackage();
    packet.report.assertionId = 'unrelated.check.v1';
    for (const cell of Object.values(packet.report.matrix) as Array<{ assertionId: string }>) cell.assertionId = packet.report.assertionId;
    packet.report.evidenceHash = evidenceHash(packet.report);
    expect(() => prepareLocalWorkflow(JSON.stringify(packet))).toThrow(/predeclared application test/);
  });

  it('rejects an unrelated source pin under the declared test even after checksum recomputation', async () => {
    const packet = await actualPackage();
    packet.report.adapters.affected.files[0].sha256 = '0'.repeat(64);
    packet.report.evidenceHash = evidenceHash(packet.report);
    expect(() => prepareLocalWorkflow(JSON.stringify(packet))).toThrow(/predeclared application test/);
  });

  it('rejects changed fixture bytes independently of the self-report checksum', async () => {
    const packet = await actualPackage();
    packet.fixtureJson += '\n';
    expect(() => prepareLocalWorkflow(JSON.stringify(packet))).toThrow();
  });

  it('rejects an altered executable wrapper despite an unchanged valid-looking manifest', async () => {
    const packet = await actualPackage();
    packet.portableRunner = 'console.log("a different runner");\n' + packet.portableRunner;
    expect(() => prepareLocalWorkflow(JSON.stringify(packet))).toThrow();
  });

  it('rejects a substituted runtime even when rendered by the trusted wrapper', async () => {
    const packet = await actualPackage();
    const manifest = manifestFrom(packet.portableRunner);
    manifest.runtime['protocol.mjs'] = '// unrelated implementation\nexport async function runOracleInput(){return {outcome:"fail",matchedExpected:true};}\n';
    packet.portableRunner = renderPortableRunner(manifest);
    expect(() => prepareLocalWorkflow(JSON.stringify(packet))).toThrow();
  });

  it('rejects a command entry point outside the declared application files before publication', async () => {
    const packet = await actualPackage();
    const manifest = manifestFrom(packet.portableRunner);
    manifest.oracle.affected.command = ['node', 'unrelated.mjs', '{input}'];
    packet.portableRunner = renderPortableRunner(manifest);
    expect(() => prepareLocalWorkflow(JSON.stringify(packet))).toThrow();
  });
});
