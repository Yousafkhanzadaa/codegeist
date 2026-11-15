import { randomUUID } from 'node:crypto';
import type { LocalVerificationEvidence, PreparedRepro, PublicVerificationEvidence, VerificationSpec } from '../shared/contracts';
import { parsePayload, PayloadError, sha256 } from './json';
import { inputContractHash } from './input-contract';

/** Shared checksum encoding; this is not execution attestation. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function object(value: unknown, keys: string[], required = keys): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PayloadError('The local evidence has an invalid object.');
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some(key => !keys.includes(key)) || required.some(key => !(key in item))) throw new PayloadError('The local evidence contains missing or unsupported fields. Raw logs and command details cannot be imported.');
  return item;
}
function digest(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new PayloadError('The local evidence has an invalid SHA-256 fingerprint.');
}
function identifier(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value)) throw new PayloadError('The local evidence has an invalid assertion or revision identifier.');
}
function adapterBinding(value: unknown) {
  const adapter = object(value, ['revision', 'files']);
  identifier(adapter.revision);
  if (!Array.isArray(adapter.files) || !adapter.files.length || adapter.files.length > 24) throw new PayloadError('Declare 1–24 hashed application files per revision in both the local runner and imported evidence.');
  const paths = new Set<string>();
  for (const raw of adapter.files) {
    const file = object(raw, ['path', 'sha256']); digest(file.sha256);
    if (typeof file.path !== 'string' || file.path.length > 200 || !/^[A-Za-z0-9_./-]+$/.test(file.path) || file.path.startsWith('/') || file.path.split('/').some(part => !part || part === '.' || part === '..') || paths.has(file.path)) throw new PayloadError('The local evidence has an invalid or repeated declared file path.');
    paths.add(file.path);
  }
  return adapter;
}
export function parseVerificationSpec(value: unknown): VerificationSpec {
  const spec = object(value, ['version', 'id', 'assertionId', 'failureKind', 'failureSite', 'affected', 'fixed'], ['version', 'id', 'assertionId', 'failureKind', 'affected']);
  if (spec.version !== 1) throw new PayloadError('Choose a supported version 1 application test specification.');
  for (const key of ['id', 'assertionId', 'failureKind']) identifier(spec[key]);
  if (spec.failureSite !== undefined) identifier(spec.failureSite);
  adapterBinding(spec.affected);
  if (spec.fixed !== undefined) adapterBinding(spec.fixed);
  return spec as unknown as VerificationSpec;
}
export function bindPreparedRepro(repro: PreparedRepro): PreparedRepro {
  const ordinaryHash = sha256(repro.ordinaryJson);
  const bindingId = repro.bindingId ?? randomUUID();
  const testSpecHash = repro.verificationSpec ? sha256(canonicalJson(parseVerificationSpec(repro.verificationSpec))) : undefined;
  // Private configuration identity is never published as an artifact receipt.
  const configurationHash = repro.configurationOrigin === 'local-workflow' ? repro.configurationHash : sha256(canonicalJson({
    version: 1, bindingId, profileId: repro.profileId, selectedPaths: [...(repro.selectedPaths ?? [])].sort(),
    applicationCaseId: repro.applicationCase?.id ?? null, inputContractHash: repro.inputContractHash ?? null,
    testSpecHash: testSpecHash ?? null, sourceHash: repro.sourceHash, fixtureHash: repro.fixtureHash, ordinaryHash,
  }));
  return { ...repro, bindingId, ordinaryHash, configurationHash, ...(testSpecHash ? { testSpecHash } : {}) };
}
/** PRIVATE source-side download: never attach this file to the receiving issue. */
export function verificationInputs(repro: PreparedRepro): string {
  if (!repro.inputContract || !repro.inputContractHash || !repro.configurationHash || !repro.ordinaryHash) throw new PayloadError('Declare input requirements and prepare a new fixture before exporting a local application check.');
  assertPreparationIntegrity(repro);
  return JSON.stringify({ version: 1, kind: 'reproshare-verification-inputs', configurationHash: repro.configurationHash,
    sourceHash: repro.sourceHash, ordinaryHash: repro.ordinaryHash, fixtureHash: repro.fixtureHash,
    inputContractHash: repro.inputContractHash, ordinaryJson: repro.ordinaryJson, fixtureJson: repro.fixtureJson, inputContract: repro.inputContract,
    ...(repro.verificationSpec ? { verificationSpec: repro.verificationSpec, testSpecHash: repro.testSpecHash } : {}),
  }, null, 2);
}
function assertPreparationIntegrity(repro: PreparedRepro) {
  if (sha256(repro.fixtureJson) !== repro.fixtureHash || sha256(repro.ordinaryJson) !== repro.ordinaryHash || !repro.inputContract || inputContractHash(repro.inputContract) !== repro.inputContractHash || bindPreparedRepro(repro).configurationHash !== repro.configurationHash || repro.verificationSpec && sha256(canonicalJson(repro.verificationSpec)) !== repro.testSpecHash) throw new PayloadError('The prepared inputs, test or requirements changed. Prepare a new fixture before using a local report.');
}
function matchesBinding(actual: unknown, expected: unknown) {
  const normalize = (v: unknown) => {
    const a = adapterBinding(v);
    return { revision: a.revision, files: [...a.files as Array<{ path: string; sha256: string }>].sort((x, y) => x.path.localeCompare(y.path)) };
  };
  return canonicalJson(normalize(actual)) === canonicalJson(normalize(expected));
}
/** Strict source-side self-report. Forge does not execute arbitrary app code. */
export function validateLocalEvidence(reportJson: string, repro: PreparedRepro): LocalVerificationEvidence {
  if (typeof reportJson !== 'string' || Buffer.byteLength(reportJson) > 24 * 1024) throw new PayloadError('Choose a local verification report of at most 24 KiB.');
  const required = ['version', 'kind', 'sourceKind', 'configurationHash', 'contractHash', 'oracleHash', 'sourceHash', 'ordinaryHash', 'fixtureHash', 'runner', 'adapters', 'assertionId', 'failureKind', 'inputValidity', 'matrix', 'verdict', 'failures', 'scope', 'evidenceHash'];
  const report = object(parsePayload(reportJson), [...required, 'evidenceLevel', 'ordinaryControl', 'failureSite', 'testSpecHash', 'repetitions'], required);
  if (report.version !== 1 || report.kind !== 'reproshare-local-verification' || report.sourceKind !== 'provided-local-source' || report.scope !== 'local-self-report-declared-files-only') throw new PayloadError('Choose a supported ReproShare local verification report.');
  if (!repro.inputContractHash || !repro.configurationHash || !repro.ordinaryHash) throw new PayloadError('This fixture has no declared input requirements. Prepare it again with an input contract before importing evidence.');
  assertPreparationIntegrity(repro);
  for (const key of ['configurationHash', 'contractHash', 'oracleHash', 'sourceHash', 'ordinaryHash', 'fixtureHash', 'evidenceHash']) digest(report[key]);
  if (report.configurationHash !== repro.configurationHash || report.contractHash !== repro.inputContractHash || report.sourceHash !== repro.sourceHash || report.ordinaryHash !== repro.ordinaryHash || report.fixtureHash !== repro.fixtureHash) throw new PayloadError('This report belongs to different source, fixture, ordinary input or requirements. Run the local check again for the current package.');
  const { evidenceHash, ...unsigned } = report;
  if (sha256(canonicalJson(unsigned)) !== evidenceHash) throw new PayloadError('The local report checksum does not match its contents.');
  identifier(report.assertionId); identifier(report.failureKind);
  if (report.failureSite !== undefined) identifier(report.failureSite);
  if (report.repetitions !== undefined && (!Number.isInteger(report.repetitions) || Number(report.repetitions) < 1 || Number(report.repetitions) > 3)) throw new PayloadError('Local repetitions must be between one and three.');
  const runner = object(report.runner, ['revision', 'sha256', 'nodeVersion']);
  identifier(runner.revision); digest(runner.sha256);
  if (typeof runner.nodeVersion !== 'string' || !/^v\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(runner.nodeVersion)) throw new PayloadError('The local report has an invalid runtime version.');
  const adapters = object(report.adapters, ['affected', 'fixed'], ['affected']);
  adapterBinding(adapters.affected);
  if (adapters.fixed !== undefined) adapterBinding(adapters.fixed);
  if (repro.verificationSpec) {
    const spec = parseVerificationSpec(repro.verificationSpec);
    if (report.testSpecHash !== repro.testSpecHash || report.assertionId !== spec.assertionId || report.failureKind !== spec.failureKind || report.failureSite !== spec.failureSite || !matchesBinding(adapters.affected, spec.affected) || adapters.fixed !== undefined && (!spec.fixed || !matchesBinding(adapters.fixed, spec.fixed))) throw new PayloadError('The local report does not match the predeclared application test, failure signature or pinned files. Run the declared test again.');
  } else throw new PayloadError('Declare the application test and pinned files before execution. Select a public case or import a connected local application workflow.');
  const validity = object(report.inputValidity, ['original', 'ordinary', 'synthetic']);
  if (Object.values(validity).some(value => value !== true)) throw new PayloadError('Every input must pass the declared input requirements.');
  const names = ['original', 'ordinary', 'synthetic', 'fixedOriginal', 'fixedOrdinary', 'fixedSynthetic'];
  const fixedNames = names.slice(3);
  const matrix = object(report.matrix, names, ['original', 'ordinary', 'synthetic', ...(adapters.fixed ? fixedNames : [])]);
  for (const name of Object.keys(matrix)) {
    if (!adapters.fixed && fixedNames.includes(name)) throw new PayloadError('Fixed results require a declared fixed adapter.');
    const cell = object(matrix[name], ['outcome', 'matchedExpected', 'assertionId', 'failureKind', 'failureSite', 'errorCode'], ['outcome', 'matchedExpected']);
    if (!['pass', 'fail', 'error'].includes(String(cell.outcome)) || typeof cell.matchedExpected !== 'boolean') throw new PayloadError('The report has an invalid matrix result.');
    for (const key of ['assertionId', 'failureKind', 'failureSite', 'errorCode']) if (cell[key] !== undefined) identifier(cell[key]);
    if (name === 'ordinary') {
      if (cell.outcome === 'error' && (cell.matchedExpected !== false || cell.errorCode === undefined)) throw new PayloadError('An inconclusive ordinary control cannot claim a matching result.');
      continue;
    }
    const expected = name === 'original' || name === 'synthetic' ? 'fail' : 'pass';
    if (cell.outcome !== expected || cell.matchedExpected !== true || cell.errorCode !== undefined || cell.assertionId !== report.assertionId || expected === 'fail' && (cell.failureKind !== report.failureKind || cell.failureSite !== report.failureSite) || cell.failureKind !== undefined && cell.failureKind !== report.failureKind) throw new PayloadError('The report does not prove the required original / synthetic failure and optional fixed comparison. A crash or unrelated failure is insufficient.');
  }
  const ordinary = matrix.ordinary as Record<string, unknown>;
  const mismatch = ['assertion-mismatch', 'failure-kind-mismatch', 'failure-site-mismatch'].includes(String(ordinary.errorCode));
  const control = ordinary.outcome === 'pass' ? 'hides-failure' : ordinary.outcome === 'fail' && ordinary.assertionId === report.assertionId && ordinary.failureKind === report.failureKind && ordinary.failureSite === report.failureSite ? 'preserves-failure' : ordinary.outcome === 'fail' || mismatch ? 'different-failure' : 'inconclusive';
  if (report.ordinaryControl !== undefined && report.ordinaryControl !== control) throw new PayloadError('The ordinary-control label does not match its measured result.');
  if (report.evidenceLevel !== undefined && report.evidenceLevel !== (adapters.fixed ? 'fix-validated' : 'failure-reproduced')) throw new PayloadError('The evidence level does not match the revisions actually tested.');
  if (report.verdict !== 'verified' || !Array.isArray(report.failures) || report.failures.length) throw new PayloadError('This report did not pass local verification. Inspect it locally and correct the adapter or fixture before importing.');
  return { ...report, evidenceLevel: adapters.fixed ? 'fix-validated' : 'failure-reproduced', ordinaryControl: control, repetitions: report.repetitions ?? 1 } as unknown as LocalVerificationEvidence;
}
/** Public receipt hashes only public data, excluding the original report hash. */
export function publicVerificationEvidence(report: LocalVerificationEvidence, bindingId: string): PublicVerificationEvidence {
  const publicPart = {
    version: 1 as const, kind: 'reproshare-public-verification' as const, sourceKind: 'private-original-checked-locally' as const, bindingId,
    contractHash: report.contractHash, ordinaryHash: report.ordinaryHash, fixtureHash: report.fixtureHash,
    runner: report.runner, adapters: report.adapters, assertionId: report.assertionId, failureKind: report.failureKind,
    inputValidity: report.inputValidity, matrix: report.matrix, verdict: report.verdict, failures: report.failures, scope: report.scope,
    ...(report.evidenceLevel ? { evidenceLevel: report.evidenceLevel } : {}), ordinaryControl: report.ordinaryControl, repetitions: report.repetitions ?? 1,
    ...(report.failureSite ? { failureSite: report.failureSite } : {}), ...(report.testSpecHash ? { testSpecHash: report.testSpecHash } : {}),
  };
  return { ...publicPart, evidenceHash: sha256(canonicalJson(publicPart)) };
}
export function verificationDisclosure(report: LocalVerificationEvidence): string {
  return `Local execution self-report: original and synthetic inputs failed the same declared assertion${report.failureSite ? ' and failure site' : ''}. Ordinary control: ${report.ordinaryControl ?? 'measured'}; ${report.adapters.fixed ? 'all three fixed-code inputs passed' : 'fix pending; no fixed revision was required'}. Forge checked report integrity and test/package binding; it did not run or remotely attest to the application. Only declared file hashes are covered.`;
}
export function attachLocalEvidence(repro: PreparedRepro, reportJson: string): PreparedRepro {
  if (repro.localVerification) throw new PayloadError('This review already has a local report. Prepare a new fixture to attach different evidence.');
  const report = validateLocalEvidence(reportJson, repro);
  // Keep the original checksum-consistent report for future private revalidation.
  const privateReport = parsePayload(reportJson) as unknown as LocalVerificationEvidence;
  const publicReport = publicVerificationEvidence(report, repro.bindingId!);
  const disclosure = verificationDisclosure(report);
  const safeComment = JSON.stringify(publicReport).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return { ...repro, localVerification: privateReport, publicVerification: publicReport,
    reportMarkdown: `${repro.reportMarkdown}\n## Local application verification (self-reported)\n\n${disclosure}\n\nAssertion: ${report.assertionId}\nPublic evidence SHA-256: ${publicReport.evidenceHash}\n\n\`\`\`json\n${JSON.stringify(publicReport, null, 2)}\n\`\`\`\n`,
    harnessCode: `${repro.harnessCode}\n// ${disclosure}\n// Public verification receipt: ${safeComment}\n`,
    limits: [...repro.limits, disclosure, 'The public contract, test specification and receipt disclose declared keys, constants, test identifiers and application file pins. Structure, relationships and reversible transformations can still disclose information; human review is required. Private source/configuration fingerprints and the original report checksum are excluded.'],
  };
}
