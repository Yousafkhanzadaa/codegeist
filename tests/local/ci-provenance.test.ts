import { generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareLocalWorkflow } from '../../src/domain/local-workflow';
import { createCiStatement, declaredBuildForSpec, parseCiTrustPolicy, signCiStatement, validateCiPublicReceipt, verifyCiStatement, type CiJob, type CiTrustPolicy } from '../../local/ci-provenance.mjs';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
function keyPair() {
  return generateKeyPairSync('ed25519', { privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
}
const job: CiJob = { provider: 'declared-local', repository: 'example/reproshare', commit: 'a'.repeat(40), workflow: '.github/workflows/public-repro.yml', runId: '1', runAttempt: 1, jobId: 'reproduce-public' };
async function setup() {
  const packet = JSON.parse(await readFile(resolve('tests/fixtures/application-workflow-review.json'), 'utf8'));
  const prepared = prepareLocalWorkflow(JSON.stringify(packet));
  const inputs = { publicReceipt: prepared.publicVerification!, fixtureBytes: prepared.fixtureJson, runnerBytes: prepared.harnessCode, testSpec: prepared.verificationSpec!, job };
  const keys = keyPair();
  const trust: CiTrustPolicy = { version: 1, kind: 'reproshare-ci-trust-policy', keyId: 'ephemeral-local-test-key', publicKeyPem: keys.publicKey,
    expectedJob: job, expectedBuild: declaredBuildForSpec(inputs.testSpec) };
  const statement = createCiStatement(inputs);
  return { packet, prepared, inputs, keys, trust, statement, envelope: signCiStatement(statement, { keyId: trust.keyId, privateKeyPem: keys.privateKey }) };
}

describe('public-only optional CI artifact signatures', () => {
  it('binds exact fixture, application runner, test, declared build and job with an independently supplied trusted key', async () => {
    const { statement, envelope, trust } = await setup();
    expect(statement.build.scope).toBe('declared-affected-application-files');
    expect(statement.job).toEqual(job);
    expect(verifyCiStatement(envelope, { trustPolicy: trust, expectedStatement: statement })).toMatchObject({
      status: 'trusted-signature-and-public-artifacts-match', execution: 'not-attested', providerIdentity: 'not-verified-by-this-tool' });
  });

  it('rejects private reports and extra private commitment fields before signing', async () => {
    const { packet, inputs } = await setup();
    expect(() => validateCiPublicReceipt(packet.report)).toThrow();
    expect(() => createCiStatement({ ...inputs, publicReceipt: { ...inputs.publicReceipt, sourceHash: packet.report.sourceHash } })).toThrow();
    expect(() => createCiStatement({ ...inputs, publicReceipt: { ...inputs.publicReceipt, runner: { ...inputs.publicReceipt.runner, configurationHash: packet.report.configurationHash } } })).toThrow();
  });

  it('contains no source, configuration, command or private-report commitment', async () => {
    const { packet, statement, envelope } = await setup();
    const text = JSON.stringify({ statement, envelope });
    for (const key of ['sourceHash', 'configurationHash', 'oracleHash', 'evidenceHash']) expect(text).not.toContain(packet.report[key]);
    expect(text).not.toContain('alpha.one@example.test');
    expect(text).not.toContain('PRIVATE KEY');
  });

  it('rejects changed input bytes or a different test specification before constructing a statement', async () => {
    const { inputs } = await setup();
    expect(() => createCiStatement({ ...inputs, fixtureBytes: inputs.fixtureBytes + '\n' })).toThrow('ci-artifact-binding-mismatch');
    expect(() => createCiStatement({ ...inputs, testSpec: { ...inputs.testSpec, assertionId: 'unrelated.assertion' } })).toThrow('ci-artifact-binding-mismatch');
  });

  it('rejects a changed runner and altered build/job policy even when the signed envelope is otherwise genuine', async () => {
    const { inputs, statement, envelope, trust } = await setup();
    const differentRunner = createCiStatement({ ...inputs, runnerBytes: inputs.runnerBytes + '\n// different bytes' });
    expect(() => verifyCiStatement(envelope, { trustPolicy: trust, expectedStatement: differentRunner })).toThrow('ci-policy-or-artifact-mismatch');
    expect(() => verifyCiStatement(envelope, { trustPolicy: { ...trust, expectedJob: { ...job, runId: '2' } }, expectedStatement: statement })).toThrow('ci-policy-or-artifact-mismatch');
    expect(() => verifyCiStatement(envelope, { trustPolicy: { ...trust, expectedBuild: { ...trust.expectedBuild, sha256: '0'.repeat(64) } }, expectedStatement: statement })).toThrow('ci-policy-or-artifact-mismatch');
  });

  it('rejects a forged signature and an attacker-selected signing key', async () => {
    const { statement, envelope, trust } = await setup();
    const attacker = keyPair();
    const attackerEnvelope = signCiStatement(statement, { keyId: trust.keyId, privateKeyPem: attacker.privateKey });
    expect(() => verifyCiStatement(attackerEnvelope, { trustPolicy: trust, expectedStatement: statement })).toThrow('invalid-ci-signature');
    expect(() => verifyCiStatement({ ...envelope, signature: Buffer.alloc(64).toString('base64') }, { trustPolicy: trust, expectedStatement: statement })).toThrow('invalid-ci-signature');
    expect(() => verifyCiStatement({ ...envelope, publicKeyPem: attacker.publicKey }, { trustPolicy: trust, expectedStatement: statement })).toThrow('invalid-ci-public-data');
    expect(() => verifyCiStatement({ ...envelope, keyId: 'attacker-key' }, { trustPolicy: trust, expectedStatement: statement })).toThrow('untrusted-ci-signer');
  });

  it('rejects algorithm confusion and private keys supplied as public trust', async () => {
    const { statement, trust, keys } = await setup();
    expect(() => parseCiTrustPolicy({ ...trust, publicKeyPem: keys.privateKey })).toThrow('invalid-ci-trusted-key');
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
    expect(() => parseCiTrustPolicy({ ...trust, publicKeyPem: rsa.publicKey })).toThrow('ci-ed25519-key-required');
    expect(() => signCiStatement(statement, { keyId: trust.keyId, privateKeyPem: rsa.privateKey })).toThrow('ci-ed25519-key-required');
  });

  it('runs an offline CLI round trip using only public artifacts, and refuses to overwrite an output', async () => {
    const { inputs, keys, trust } = await setup();
    const directory = await mkdtemp(join(tmpdir(), 'reproshare-ci-test-')); directories.push(directory);
    const files: Record<string, string> = { 'public.json': JSON.stringify(inputs.publicReceipt), 'fixture.json': inputs.fixtureBytes,
      'runner.mjs': inputs.runnerBytes, 'spec.json': JSON.stringify(inputs.testSpec), 'job.json': JSON.stringify(job),
      'trust.json': JSON.stringify(trust), 'private.pem': keys.privateKey };
    await Promise.all(Object.entries(files).map(([name, text]) => writeFile(join(directory, name), text, { mode: 0o600 })));
    const path = (name: string) => join(directory, name);
    const common = ['--public-receipt', path('public.json'), '--fixture', path('fixture.json'), '--runner', path('runner.mjs'), '--test-spec', path('spec.json')];
    const run = (args: string[]) => spawnSync(process.execPath, [resolve('scripts/reproshare-ci.mjs'), ...args], { encoding: 'utf8', timeout: 10000 });
    const manifest = run(['manifest', ...common, '--job', path('job.json'), '--out', path('manifest.json')]);
    expect(manifest.status, manifest.stderr).toBe(0);
    const signed = run(['sign', '--manifest', path('manifest.json'), '--key-id', trust.keyId, '--private-key', path('private.pem'), '--out', path('signed.json')]);
    expect(signed.status, signed.stderr).toBe(0);
    const verified = run(['verify', ...common, '--signed', path('signed.json'), '--trust', path('trust.json'), '--out', path('verified.json')]);
    expect(verified.status, verified.stderr).toBe(0);
    expect(JSON.parse(await readFile(path('verified.json'), 'utf8')).execution).toBe('not-attested');
    expect(manifest.stdout + signed.stdout + verified.stdout).not.toContain(keys.privateKey);
    expect(run(['manifest', ...common, '--job', path('job.json'), '--out', path('manifest.json')]).status).toBe(1);
  });
});
