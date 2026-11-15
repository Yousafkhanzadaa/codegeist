import type { PreparedRepro } from '../shared/contracts';
import { JSON_LIMITS, parseBoundedJson } from '../../local/json.mjs';
import { parseInputContract, inputContractHash, validateContractPayload } from './input-contract';
import { leavesOf, parsePayload, PayloadError, sha256 } from './json';
import { attachLocalEvidence, bindPreparedRepro, canonicalJson, parseVerificationSpec } from './verification';
import { renderPortableRunner } from '../../local/portable-template.mjs';
import { PORTABLE_RUNTIME_HASHES } from '../../local/portable-runtime-hashes.mjs';

const fail = (): never => { throw new PayloadError('The application workflow package is incomplete, changed or unsupported. Export a fresh reviewed workflow-review.json with the local tool.'); };
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(); return value as Record<string, unknown>; }
function boundedText(value: unknown, max: number): string { if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > max) return fail(); return value; }

/** Parse data embedded by the portable exporter; never evaluate imported code. */
function verifyPortable(runner: string, fixtureHash: string, contractHash: string, spec: ReturnType<typeof parseVerificationSpec>) {
  const marker = 'const packageData = ';
  const begin = runner.indexOf(marker);
  const end = runner.indexOf(';\nconst hash =', begin);
  if (begin < 0 || end < 0) return fail();
  const manifest = record(parseBoundedJson(runner.slice(begin + marker.length, end), { ...JSON_LIMITS, bytes: 180 * 1024, string: 140 * 1024 }));
  if (manifest.version !== 1 || manifest.fixtureHash !== fixtureHash || canonicalJson(manifest.spec) !== canonicalJson(spec) || inputContractHash(parseInputContract(manifest.contract)) !== contractHash) return fail();
  const sources = record(manifest.sources);
  const runtime = record(manifest.runtime);
  if (Object.keys(runtime).length !== Object.keys(PORTABLE_RUNTIME_HASHES).length || Object.entries(PORTABLE_RUNTIME_HASHES).some(([name, hash]) => typeof runtime[name] !== 'string' || sha256(runtime[name] as string) !== hash)) return fail();
  if (runner !== renderPortableRunner(manifest)) return fail();
  const expected = new Set<string>();
  for (const adapter of [spec.affected, spec.fixed].filter(Boolean)) for (const file of adapter!.files) {
    expected.add(file.path);
    if (typeof sources[file.path] !== 'string' || sha256(sources[file.path] as string) !== file.sha256) return fail();
  }
  if (Object.keys(sources).some(path => !expected.has(path))) return fail();
  const oracle = record(manifest.oracle);
  if (oracle.assertionId !== spec.assertionId || oracle.failureKind !== spec.failureKind || oracle.failureSite !== spec.failureSite) return fail();
  for (const name of ['affected', 'fixed'] as const) {
    const expectedAdapter = spec[name];
    if (!expectedAdapter) { if (oracle[name] !== undefined) return fail(); continue; }
    const adapter = record(oracle[name]);
    if (adapter.revision !== expectedAdapter.revision || canonicalJson(adapter.files) !== canonicalJson(expectedAdapter.files) || !Array.isArray(adapter.command) || adapter.command.length < 2 || !['node', 'python3'].includes(String(adapter.command[0])) || adapter.command.filter(arg => arg === '{input}').length !== 1 || adapter.command.slice(1).some(arg => typeof arg !== 'string' || arg !== '{input}' && (!/^[A-Za-z0-9_./-]+$/.test(arg) || arg.startsWith('/') || arg.startsWith('-') || arg.split('/').some(part => part === '..' || !part)))) return fail();
    if (!(adapter.command as string[]).some(arg => expectedAdapter.files.some(file => file.path === arg))) return fail();
  }
}

/** Source-authorized import. Private report bindings stay inside the review. */
export function prepareLocalWorkflow(packageJson: string): PreparedRepro {
  if (typeof packageJson !== 'string' || Buffer.byteLength(packageJson) > 256 * 1024) throw new PayloadError('Choose a workflow-review.json package of at most 256 KiB.');
  const value = record(parseBoundedJson(packageJson, { ...JSON_LIMITS, bytes: 256 * 1024, string: 180 * 1024 }));
  const allowed = ['version', 'kind', 'profileId', 'title', 'fixtureJson', 'ordinaryJson', 'inputContract', 'verificationSpec', 'report', 'portableRunner', 'disclosures', 'searchSummary'];
  if (Object.keys(value).some(key => !allowed.includes(key)) || value.version !== 1 || value.kind !== 'reproshare-workflow-review') return fail();
  const serviceId = boundedText(value.profileId, 120);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(serviceId)) return fail();
  const title = boundedText(value.title, 160);
  if (/[\u0000-\u001f]/.test(title)) return fail();
  const fixtureJson = boundedText(value.fixtureJson, 64 * 1024);
  const ordinaryJson = boundedText(value.ordinaryJson, 64 * 1024);
  const fixture = parsePayload(fixtureJson);
  const ordinary = parsePayload(ordinaryJson);
  const inputContract = parseInputContract(value.inputContract);
  if (![fixture, ordinary].every(input => validateContractPayload(input, inputContract).valid)) throw new PayloadError('The imported fixture or control fails its declared input requirements. Regenerate the local result.');
  const spec = parseVerificationSpec(value.verificationSpec);
  if (spec.id !== serviceId) return fail();
  const report = record(value.report);
  for (const name of ['sourceHash', 'configurationHash']) if (typeof report[name] !== 'string' || !/^[a-f0-9]{64}$/.test(report[name] as string)) return fail();
  const runner = boundedText(value.portableRunner, 140 * 1024);
  const fixtureHash = sha256(fixtureJson);
  const contractHash = inputContractHash(inputContract);
  verifyPortable(runner, fixtureHash, contractHash, spec);
  for (const key of ['sourceHash', 'configurationHash', 'oracleHash', 'evidenceHash']) if (typeof report[key] === 'string' && runner.includes(report[key] as string)) throw new PayloadError('The portable runner contains a private report fingerprint. Export a new package without private bindings.');
  if (!Array.isArray(value.disclosures) || value.disclosures.length > 20 || value.disclosures.some(item => typeof item !== 'string' || item.length > 1200 || /[\u0000-\u001f]/.test(item))) return fail();
  const stats = value.searchSummary === undefined ? {} : record(value.searchSummary);
  const safeStats: Record<string, number | boolean> = {};
  for (const key of ['runs', 'candidates', 'invalidCandidates', 'differentOutcomes', 'minimizationChecks', 'removedParts', 'elapsedMs', 'originalBytes', 'fixtureBytes']) {
    if (stats[key] !== undefined) {
      if (!Number.isSafeInteger(stats[key]) || Number(stats[key]) < 0 || Number(stats[key]) > 10_000_000) return fail();
      safeStats[key] = Number(stats[key]);
    }
  }
  if (stats.stoppedByBudget !== undefined) safeStats.stoppedByBudget = stats.stoppedByBudget === true;
  const base = bindPreparedRepro({
    version: 1, profileId: 'application', title, sourceHash: report.sourceHash as string, fixtureHash, fixtureJson, ordinaryJson,
    configurationHash: report.configurationHash as string, configurationOrigin: 'local-workflow',
    verificationSpec: spec, inputContract, inputContractHash: contractHash,
    checks: [{ id: 'input-validity', label: 'Public fixture and control satisfy input requirements', passed: true, detail: 'Original validity and application outcomes are checked against the imported local self-report.' }],
    comparison: { label: 'Declared application assertion (see execution matrix)', expected: 0, source: 1, ordinary: 0, synthetic: 1, fixed: 0, unit: 'assertion failures' },
    transformations: leavesOf(fixture).map(leaf => ({ path: leaf.path, rule: 'Locally generated value; inspect public constants, retained structure and reversible Boolean changes.' })),
    changedValueCount: 0,
    limits: ['Actual application execution occurred in the source operator’s authorised local environment. Forge validates the imported evidence; it does not attest execution.', 'The recipient independently runs only the synthetic input. Original input and private source/configuration commitments are excluded from published evidence.', 'Inspect all embedded application/test code and remaining information before approval. Matching an assertion/site does not prove an identical root cause or anonymity.', ...value.disclosures as string[]],
    reportMarkdown: `# Application reproduction\n\nService profile: ${serviceId}\n\nRun the reviewed application assertion with Node.js 24 or later:\n\n\`\`\`sh\nnode application-reproducer.mjs --allow-command fixture.json\n\`\`\`\n\nInput requirements and test file pins are public. The original remains private.\n`,
    harnessCode: runner, workflowSummary: { profileId: serviceId, attempts: Number(safeStats.candidates ?? 0), ...safeStats },
  });
  const prepared = attachLocalEvidence(base, JSON.stringify(report));
  const control = prepared.publicVerification?.ordinaryControl;
  prepared.comparison.ordinary = control === 'preserves-failure' ? 1 : 0;
  if (Buffer.byteLength(JSON.stringify(prepared)) > 218 * 1024) throw new PayloadError('The reviewed application package exceeds the safe storage budget. Minimise the fixture or reduce the declared source files.');
  return prepared;
}
