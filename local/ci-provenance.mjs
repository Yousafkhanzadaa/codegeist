import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { canonicalJson, parseBoundedJson, VerificationError } from './json.mjs';
import { parseVerificationSpec } from './protocol.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const HASH = /^[a-f0-9]{64}$/;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const fail = code => { throw new VerificationError(code); };
function exact(value, allowed, required = allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))
    || required.some(key => !Object.hasOwn(value, key))) fail('invalid-ci-public-data');
  return value;
}
function hash(value) { if (typeof value !== 'string' || !HASH.test(value)) fail('invalid-ci-digest'); }
function token(value) { if (typeof value !== 'string' || !TOKEN.test(value)) fail('invalid-ci-identifier'); }

/** Public projection only. Private execution reports are deliberately rejected. */
export function validateCiPublicReceipt(value) {
  const required = ['version', 'kind', 'sourceKind', 'bindingId', 'contractHash', 'ordinaryHash', 'fixtureHash', 'runner', 'adapters', 'assertionId', 'failureKind', 'inputValidity', 'matrix', 'verdict', 'failures', 'scope', 'ordinaryControl', 'repetitions', 'evidenceHash'];
  exact(value, [...required, 'evidenceLevel', 'failureSite', 'testSpecHash'], required);
  if (value.version !== 1 || value.kind !== 'reproshare-public-verification' || value.sourceKind !== 'private-original-checked-locally'
    || value.verdict !== 'verified' || value.scope !== 'local-self-report-declared-files-only'
    || !Array.isArray(value.failures) || value.failures.length || !Number.isInteger(value.repetitions) || value.repetitions < 1 || value.repetitions > 3
    || !['hides-failure', 'preserves-failure', 'different-failure', 'invalid', 'inconclusive'].includes(value.ordinaryControl)
    || value.evidenceLevel !== undefined && !['failure-reproduced', 'fix-validated'].includes(value.evidenceLevel)) fail('public-receipt-required');
  for (const key of ['bindingId', 'assertionId', 'failureKind']) token(value[key]);
  for (const key of ['contractHash', 'ordinaryHash', 'fixtureHash', 'evidenceHash']) hash(value[key]);
  if (value.failureSite !== undefined) token(value.failureSite);
  if (value.testSpecHash !== undefined) hash(value.testSpecHash);
  exact(value.runner, ['revision', 'sha256', 'nodeVersion']); token(value.runner.revision); hash(value.runner.sha256);
  if (typeof value.runner.nodeVersion !== 'string' || !/^v\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value.runner.nodeVersion)) fail('invalid-ci-runtime');
  exact(value.adapters, ['affected', 'fixed'], ['affected']);
  parseVerificationSpec({ version: 1, id: 'ci-public-receipt', assertionId: value.assertionId, failureKind: value.failureKind,
    ...(value.failureSite ? { failureSite: value.failureSite } : {}), ...value.adapters });
  exact(value.inputValidity, ['original', 'ordinary', 'synthetic']);
  if (Object.values(value.inputValidity).some(valid => valid !== true)) fail('invalid-ci-input-validity');
  exact(value.matrix, ['original', 'ordinary', 'synthetic', 'fixedOriginal', 'fixedOrdinary', 'fixedSynthetic'], ['original', 'ordinary', 'synthetic']);
  for (const cell of Object.values(value.matrix)) {
    exact(cell, ['outcome', 'matchedExpected', 'assertionId', 'failureKind', 'failureSite', 'errorCode'], ['outcome', 'matchedExpected']);
    if (!['pass', 'fail', 'error'].includes(cell.outcome) || typeof cell.matchedExpected !== 'boolean') fail('invalid-ci-matrix');
    for (const key of ['assertionId', 'failureKind', 'failureSite', 'errorCode']) if (cell[key] !== undefined) token(cell[key]);
  }
  for (const name of ['original', 'synthetic']) {
    const cell = value.matrix[name];
    if (cell.outcome !== 'fail' || !cell.matchedExpected || cell.assertionId !== value.assertionId
      || cell.failureKind !== value.failureKind || cell.failureSite !== value.failureSite || cell.errorCode !== undefined) fail('public-receipt-not-reproduced');
  }
  for (const name of ['fixedOriginal', 'fixedOrdinary', 'fixedSynthetic']) {
    const cell = value.matrix[name];
    if (value.adapters.fixed ? !cell || cell.outcome !== 'pass' || !cell.matchedExpected || cell.assertionId !== value.assertionId
      || cell.failureKind !== undefined || cell.failureSite !== undefined || cell.errorCode !== undefined : cell !== undefined) fail('invalid-ci-fixed-evidence');
  }
  if (value.evidenceLevel !== undefined && value.evidenceLevel !== (value.adapters.fixed ? 'fix-validated' : 'failure-reproduced')) fail('invalid-ci-evidence-level');
  const { evidenceHash, ...unsigned } = value;
  if (digest(canonicalJson(unsigned)) !== evidenceHash) fail('public-receipt-checksum-mismatch');
  return value;
}

export function parseCiJob(value) {
  exact(value, ['provider', 'repository', 'commit', 'workflow', 'runId', 'runAttempt', 'jobId']);
  if (!['github-actions', 'declared-local'].includes(value.provider)
    || typeof value.repository !== 'string' || !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(value.repository)
    || typeof value.commit !== 'string' || !/^[a-f0-9]{40}$/.test(value.commit)
    || typeof value.workflow !== 'string' || !/^\.github\/workflows\/[A-Za-z0-9_.-]{1,100}\.ya?ml$/.test(value.workflow)
    || typeof value.runId !== 'string' || !/^[1-9][0-9]{0,19}$/.test(value.runId)
    || !Number.isSafeInteger(value.runAttempt) || value.runAttempt < 1 || value.runAttempt > 1000) fail('invalid-ci-job');
  token(value.jobId);
  return value;
}

export function declaredBuildForSpec(testSpec) {
  const spec = parseVerificationSpec(testSpec);
  return { scope: 'declared-affected-application-files', revision: spec.affected.revision, sha256: digest(canonicalJson(spec.affected)) };
}

function parseStatement(value) {
  exact(value, ['version', 'kind', 'fixtureHash', 'applicationRunnerHash', 'testSpecHash', 'publicReceiptHash', 'build', 'job', 'executionEvidence']);
  if (value.version !== 1 || value.kind !== 'reproshare-ci-public-artifacts' || value.executionEvidence !== 'local-self-report-not-upgraded') fail('invalid-ci-statement');
  for (const key of ['fixtureHash', 'applicationRunnerHash', 'testSpecHash', 'publicReceiptHash']) hash(value[key]);
  exact(value.build, ['scope', 'revision', 'sha256']); token(value.build.revision); hash(value.build.sha256);
  if (value.build.scope !== 'declared-affected-application-files') fail('invalid-ci-build');
  parseCiJob(value.job);
  return value;
}

/** No original input/report/command fingerprint is accepted or included. */
export function createCiStatement({ publicReceipt, fixtureBytes, runnerBytes, testSpec, job }) {
  const receipt = validateCiPublicReceipt(publicReceipt);
  const spec = parseVerificationSpec(testSpec);
  const specHash = digest(canonicalJson(spec));
  const fixtureHash = digest(fixtureBytes);
  if (receipt.fixtureHash !== fixtureHash || receipt.testSpecHash !== specHash || receipt.assertionId !== spec.assertionId
    || receipt.failureKind !== spec.failureKind || receipt.failureSite !== spec.failureSite
    || canonicalJson(receipt.adapters.affected) !== canonicalJson(spec.affected)
    || receipt.adapters.fixed && canonicalJson(receipt.adapters.fixed) !== canonicalJson(spec.fixed)) fail('ci-artifact-binding-mismatch');
  return parseStatement({ version: 1, kind: 'reproshare-ci-public-artifacts', fixtureHash,
    applicationRunnerHash: digest(runnerBytes), testSpecHash: specHash, publicReceiptHash: digest(canonicalJson(receipt)),
    build: declaredBuildForSpec(spec), job: parseCiJob(job), executionEvidence: 'local-self-report-not-upgraded' });
}

/** Signature covers identity and all public artifacts. It is not proof a test ran. */
export function signCiStatement(statement, { keyId, privateKeyPem }) {
  token(keyId); parseStatement(statement);
  let key;
  try { key = createPrivateKey(privateKeyPem); } catch { fail('invalid-ci-signing-key'); }
  if (key.asymmetricKeyType !== 'ed25519') fail('ci-ed25519-key-required');
  return { version: 1, kind: 'reproshare-ci-signed-public-artifacts', algorithm: 'Ed25519', keyId, statement,
    signature: sign(null, Buffer.from(canonicalJson(statement)), key).toString('base64') };
}

/** Trust is supplied separately by the verifier, never read from the envelope. */
export function parseCiTrustPolicy(value) {
  exact(value, ['version', 'kind', 'keyId', 'publicKeyPem', 'expectedJob', 'expectedBuild']);
  if (value.version !== 1 || value.kind !== 'reproshare-ci-trust-policy') fail('invalid-ci-trust-policy');
  token(value.keyId); parseCiJob(value.expectedJob);
  exact(value.expectedBuild, ['scope', 'revision', 'sha256']); token(value.expectedBuild.revision); hash(value.expectedBuild.sha256);
  if (value.expectedBuild.scope !== 'declared-affected-application-files') fail('invalid-ci-trust-policy');
  if (typeof value.publicKeyPem !== 'string' || value.publicKeyPem.length > 4096 || !value.publicKeyPem.startsWith('-----BEGIN PUBLIC KEY-----')) fail('invalid-ci-trusted-key');
  let key;
  try { key = createPublicKey(value.publicKeyPem); } catch { fail('invalid-ci-trusted-key'); }
  if (key.asymmetricKeyType !== 'ed25519') fail('ci-ed25519-key-required');
  return value;
}

export function verifyCiStatement(envelope, { trustPolicy, expectedStatement }) {
  const trust = parseCiTrustPolicy(trustPolicy);
  parseStatement(expectedStatement);
  exact(envelope, ['version', 'kind', 'algorithm', 'keyId', 'statement', 'signature']);
  if (envelope.version !== 1 || envelope.kind !== 'reproshare-ci-signed-public-artifacts' || envelope.algorithm !== 'Ed25519'
    || envelope.keyId !== trust.keyId) fail('untrusted-ci-signer');
  parseStatement(envelope.statement);
  if (canonicalJson(envelope.statement) !== canonicalJson(expectedStatement)
    || canonicalJson(envelope.statement.job) !== canonicalJson(trust.expectedJob)
    || canonicalJson(envelope.statement.build) !== canonicalJson(trust.expectedBuild)) fail('ci-policy-or-artifact-mismatch');
  if (typeof envelope.signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature)) fail('invalid-ci-signature');
  const bytes = Buffer.from(envelope.signature, 'base64');
  if (bytes.length !== 64 || bytes.toString('base64') !== envelope.signature
    || !verify(null, Buffer.from(canonicalJson(envelope.statement)), createPublicKey(trust.publicKeyPem), bytes)) fail('invalid-ci-signature');
  return { status: 'trusted-signature-and-public-artifacts-match', keyId: trust.keyId, fixtureHash: envelope.statement.fixtureHash,
    testSpecHash: envelope.statement.testSpecHash, execution: 'not-attested', providerIdentity: 'not-verified-by-this-tool',
    scope: 'separately-trusted-key-and-exact-artifact-policy; GitHub OIDC verification is a separate step' };
}

export function parseCiJson(bytes, maxBytes = 32 * 1024) {
  return parseBoundedJson(bytes, { bytes: maxBytes, depth: 20, nodes: 2000, keys: 256, array: 128, string: maxBytes });
}
