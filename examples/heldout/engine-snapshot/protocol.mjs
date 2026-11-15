import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { lstat, mkdtemp, open, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inputContractHash, parseContractPayload, parseInputContract, validateContractPayload } from './input-contract.mjs';
import { canonicalJson, JSON_LIMITS, parseBoundedJson, VerificationError } from './json.mjs';

export const RUNNER_REVISION = 'reproshare-local-oracle-v2';
const HASH = /^[a-f0-9]{64}$/;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const MAX_CONFIG_BYTES = 65_536;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
const CELL_SPECS = [
  ['original', 'affected', 'original', 'fail'],
  ['ordinary', 'affected', 'ordinary', undefined],
  ['synthetic', 'affected', 'synthetic', 'fail'],
  ['fixedOriginal', 'fixed', 'original', 'pass'],
  ['fixedOrdinary', 'fixed', 'ordinary', 'pass'],
  ['fixedSynthetic', 'fixed', 'synthetic', 'pass'],
];

export function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
export function evidenceHash(report) {
  const { evidenceHash: ignored, ...payload } = report;
  return sha256(canonicalJson(payload));
}
function invalid(code = 'invalid-oracle-configuration') { throw new VerificationError(code); }
function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function exactKeys(value, allowed, required = allowed) {
  if (!record(value) || Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) invalid();
}
function publicToken(value) { return typeof value === 'string' && TOKEN.test(value); }
function relativeFile(value) {
  return typeof value === 'string' && value.length <= 200 && /^[A-Za-z0-9._/-]+$/.test(value)
    && !isAbsolute(value) && !value.split('/').some(part => part === '' || part === '.' || part === '..');
}

export function parseOracleConfiguration(value) {
  exactKeys(value, ['version', 'id', 'assertionId', 'failureKind', 'failureSite', 'affected', 'fixed', 'limits'], ['version', 'id', 'assertionId', 'failureKind', 'affected']);
  if (value.version !== 1 || ![value.id, value.assertionId, value.failureKind].every(publicToken)) invalid();
  if (value.failureSite !== undefined && !publicToken(value.failureSite)) invalid();
  for (const adapter of [value.affected, value.fixed].filter(item => item !== undefined)) {
    exactKeys(adapter, ['revision', 'command', 'files']);
    if (!publicToken(adapter.revision) || !Array.isArray(adapter.command) || adapter.command.length < 2 || adapter.command.length > 32) invalid();
    if (adapter.command.some(arg => typeof arg !== 'string' || arg.length === 0 || arg.length > 2_048 || /[\u0000-\u001f\u007f]/.test(arg))) invalid();
    if (adapter.command.reduce((size, arg) => size + Buffer.byteLength(arg), 0) > 8_192
      || adapter.command.filter(arg => arg === '{input}').length !== 1
      || adapter.command.some(arg => arg.includes('{') || arg.includes('}') ? arg !== '{input}' : false)) invalid();
    // Explicit local consent is still required. These are argv, never a shell
    // command string; the chosen executable itself remains fully trusted code.
    if (!Array.isArray(adapter.files) || adapter.files.length < 1 || adapter.files.length > 24) invalid();
    const names = new Set();
    for (const file of adapter.files) {
      exactKeys(file, ['path', 'sha256']);
      if (!relativeFile(file.path) || typeof file.sha256 !== 'string' || !HASH.test(file.sha256) || names.has(file.path)) invalid();
      names.add(file.path);
    }
    if (!adapter.command.some(arg => names.has(arg))) invalid('command-entrypoint-not-pinned');
  }
  if (value.limits !== undefined) {
    exactKeys(value.limits, ['timeoutMs', 'maxOutputBytes', 'repetitions', 'maxDurationMs'], []);
    if (value.limits.timeoutMs !== undefined && (!Number.isInteger(value.limits.timeoutMs) || value.limits.timeoutMs < 10 || value.limits.timeoutMs > 30_000)) invalid();
    if (value.limits.maxOutputBytes !== undefined && (!Number.isInteger(value.limits.maxOutputBytes) || value.limits.maxOutputBytes < 128 || value.limits.maxOutputBytes > 65_536)) invalid();
    if (value.limits.repetitions !== undefined && (!Number.isInteger(value.limits.repetitions) || value.limits.repetitions < 1 || value.limits.repetitions > 3)) invalid();
    if (value.limits.maxDurationMs !== undefined && (!Number.isInteger(value.limits.maxDurationMs) || value.limits.maxDurationMs < 100 || value.limits.maxDurationMs > 120_000)) invalid();
  }
  return value;
}

async function boundedFile(path, cap = MAX_CONFIG_BYTES) {
  const entry = await lstat(path).catch(() => { invalid('file-unavailable'); });
  if (!entry.isFile() || entry.isSymbolicLink()) invalid('file-not-regular');
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)).catch(() => { invalid('file-unavailable'); });
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) invalid('file-not-regular');
    if (stat.size > cap) invalid('file-size-limit');
    const buffer = Buffer.alloc(cap + 1);
    let length = 0;
    while (length <= cap) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
      if (length > cap) invalid('file-size-limit');
    }
    return buffer.subarray(0, length);
  } finally { await handle.close(); }
}

async function assertPinnedFiles(adapter, cwd) {
  let total = 0;
  for (const file of adapter.files) {
    let current = cwd;
    for (const part of file.path.split('/')) {
      current = join(current, part);
      const stat = await lstat(current).catch(() => { invalid('adapter-file-unavailable'); });
      if (stat.isSymbolicLink()) invalid('adapter-symlink-rejected');
    }
    const target = await realpath(current).catch(() => { invalid('adapter-file-unavailable'); });
    const rel = relative(cwd, target);
    if (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep)) invalid('adapter-path-escape');
    const bytes = await boundedFile(target, MAX_FILE_BYTES);
    total += bytes.length;
    if (total > MAX_MANIFEST_BYTES) invalid('adapter-manifest-size-limit');
    if (sha256(bytes) !== file.sha256) invalid('adapter-hash-mismatch');
  }
}

async function runnerBinding() {
  const base = dirname(fileURLToPath(import.meta.url));
  const paths = ['protocol.mjs', 'json.mjs', 'input-contract.mjs', '../scripts/reproshare-check.mjs'];
  const files = [];
  for (const path of paths) files.push({ path, sha256: sha256(await readFile(join(base, path))) });
  return { revision: RUNNER_REVISION, sha256: sha256(canonicalJson(files)), nodeVersion: process.version };
}

function oracleResult(stdout, expected, expectedOutcome) {
  let result;
  try { result = parseBoundedJson(stdout, { ...JSON_LIMITS, bytes: 65_536, nodes: 16, keys: 8, depth: 2, string: 128, array: 0 }); }
  catch { return { outcome: 'error', matchedExpected: false, errorCode: 'malformed-oracle-result' }; }
  if (!record(result) || result.version !== 1 || !['pass', 'fail'].includes(result.outcome)
    || Object.keys(result).some(key => !['version', 'assertionId', 'outcome', 'failureKind', 'failureSite'].includes(key))
    || typeof result.assertionId !== 'string'
    || (result.outcome === 'pass' && (Object.hasOwn(result, 'failureKind') || Object.hasOwn(result, 'failureSite')))
    || (result.outcome === 'fail' && typeof result.failureKind !== 'string')) {
    return { outcome: 'error', matchedExpected: false, errorCode: 'malformed-oracle-result' };
  }
  if (result.assertionId !== expected.assertionId) return { outcome: 'error', matchedExpected: false, errorCode: 'assertion-mismatch' };
  if (result.outcome === 'fail' && result.failureKind !== expected.failureKind) {
    return { outcome: 'error', matchedExpected: false, assertionId: expected.assertionId, errorCode: 'failure-kind-mismatch' };
  }
  if (result.outcome === 'fail' && ((expected.failureSite !== undefined && result.failureSite !== expected.failureSite)
    || (result.failureSite !== undefined && !publicToken(result.failureSite)))) {
    return { outcome: 'error', matchedExpected: false, assertionId: expected.assertionId, errorCode: 'failure-site-mismatch' };
  }
  return { outcome: result.outcome, assertionId: expected.assertionId,
    ...(result.outcome === 'fail' ? { failureKind: expected.failureKind,
      ...(result.failureSite !== undefined ? { failureSite: result.failureSite } : {}) } : {}),
    matchedExpected: expectedOutcome === undefined || result.outcome === expectedOutcome };
}

function runOracle(command, inputPath, cwd, temp, config, expectedOutcome) {
  return new Promise(resolveResult => {
    const output = [];
    let outputBytes = 0;
    let errorCode;
    let closed = false;
    const timeoutMs = config.limits?.timeoutMs ?? 5_000;
    const maxOutputBytes = config.limits?.maxOutputBytes ?? 16_384;
    const argv = command.slice(1).map(arg => arg === '{input}' ? inputPath : arg);
    const child = spawn(command[0], argv, { cwd, shell: false, detached: process.platform !== 'win32', windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      // An oracle receives no inherited API keys/session variables. This is not
      // a sandbox: explicitly authorized code still has OS user permissions.
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C.UTF-8', PYTHONUTF8: '1', TMPDIR: temp,
        ...(process.platform === 'win32' && process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) },
    });
    function signal(signalName) {
      if (closed || !child.pid) return;
      try { if (process.platform === 'win32') child.kill(signalName); else process.kill(-child.pid, signalName); } catch { /* already exited */ }
    }
    function stop(code) {
      if (errorCode) return;
      errorCode = code;
      // Kill the entire process group immediately: allowing the parent to exit
      // first could strand a child that ignores TERM and closes inherited pipes.
      signal('SIGKILL');
    }
    const timer = setTimeout(() => stop('oracle-timeout'), timeoutMs);
    const collect = (chunk, keep) => {
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) { stop('oracle-output-limit'); return; }
      if (keep && !errorCode) output.push(chunk);
    };
    child.stdout.on('data', chunk => collect(chunk, true));
    child.stderr.on('data', chunk => collect(chunk, false));
    child.once('error', () => { errorCode = 'oracle-launch-failed'; });
    child.once('close', code => {
      closed = true;
      clearTimeout(timer);
      if (errorCode || code !== 0) resolveResult({ outcome: 'error', matchedExpected: false, errorCode: errorCode ?? 'oracle-nonzero-exit' });
      else resolveResult(oracleResult(Buffer.concat(output), config, expectedOutcome));
    });
  });
}

function parsePackage(value) {
  const required = ['version', 'kind', 'configurationHash', 'sourceHash', 'ordinaryHash', 'fixtureHash', 'inputContractHash', 'ordinaryJson', 'fixtureJson', 'inputContract'];
  exactKeys(value, [...required, 'verificationSpec', 'testSpecHash'], required);
  if (value.version !== 1 || value.kind !== 'reproshare-verification-inputs'
    || !['configurationHash', 'sourceHash', 'ordinaryHash', 'fixtureHash', 'inputContractHash'].every(key => typeof value[key] === 'string' && HASH.test(value[key]))
    || typeof value.ordinaryJson !== 'string' || typeof value.fixtureJson !== 'string') invalid('invalid-verification-package');
  return value;
}

const adapterBinding = adapter => ({ revision: adapter.revision, files: adapter.files.map(file => ({ ...file })) });

/** Public, predeclared identity. It contains no executable command or private input. */
export function parseVerificationSpec(value) {
  exactKeys(value, ['version', 'id', 'assertionId', 'failureKind', 'failureSite', 'affected', 'fixed'], ['version', 'id', 'assertionId', 'failureKind', 'affected']);
  if (value.version !== 1 || ![value.id, value.assertionId, value.failureKind].every(publicToken)
    || value.failureSite !== undefined && !publicToken(value.failureSite)) invalid('invalid-verification-spec');
  for (const adapter of [value.affected, value.fixed].filter(item => item !== undefined)) {
    exactKeys(adapter, ['revision', 'files']);
    if (!publicToken(adapter.revision) || !Array.isArray(adapter.files) || adapter.files.length < 1 || adapter.files.length > 24) invalid('invalid-verification-spec');
    const seen = new Set();
    for (const file of adapter.files) {
      exactKeys(file, ['path', 'sha256']);
      if (!relativeFile(file.path) || typeof file.sha256 !== 'string' || !HASH.test(file.sha256) || seen.has(file.path)) invalid('invalid-verification-spec');
      seen.add(file.path);
    }
  }
  return value;
}

function bindOracleToSpec(oracle, spec) {
  if (oracle.id !== spec.id || oracle.assertionId !== spec.assertionId || oracle.failureKind !== spec.failureKind
    || oracle.failureSite !== spec.failureSite
    || canonicalJson(adapterBinding(oracle.affected)) !== canonicalJson(spec.affected)
    || oracle.fixed && (!spec.fixed || canonicalJson(adapterBinding(oracle.fixed)) !== canonicalJson(spec.fixed))) invalid('oracle-test-spec-mismatch');
}

/** Execute explicitly authorised local code, with the same pinning and log exclusions as verification. */
export async function runOracleInput(options) {
  if (options.allowCommand !== true) invalid('command-consent-required');
  if (typeof options.cwd !== 'string' || !options.cwd) invalid('explicit-working-directory-required');
  const cwd = await realpath(resolve(options.cwd)).catch(() => { invalid('working-directory-unavailable'); });
  if (!(await lstat(cwd)).isDirectory()) invalid('working-directory-unavailable');
  const oracle = parseOracleConfiguration(options.oracle);
  const adapter = oracle[options.revision ?? 'affected'];
  if (!adapter) invalid('adapter-not-configured');
  if (options.revision !== undefined && !['affected', 'fixed'].includes(options.revision)) invalid('invalid-adapter-revision');
  if (options.expectedOutcome !== undefined && !['pass', 'fail'].includes(options.expectedOutcome)) invalid('invalid-expected-outcome');
  const input = typeof options.input === 'string' ? Buffer.from(options.input) : Buffer.from(options.input ?? []);
  parseBoundedJson(input);
  await assertPinnedFiles(adapter, cwd);
  const temp = await mkdtemp(join(tmpdir(), 'reproshare-oracle-'));
  try {
    const inputPath = join(temp, 'input.json');
    await writeFile(inputPath, input, { mode: 0o600 });
    let result = await runOracle(adapter.command, inputPath, cwd, temp, oracle, options.expectedOutcome);
    try {
      if (sha256(await boundedFile(inputPath)) !== sha256(input)) result = { outcome: 'error', matchedExpected: false, errorCode: 'oracle-input-mutated' };
    } catch { result = { outcome: 'error', matchedExpected: false, errorCode: 'oracle-input-mutated' }; }
    await assertPinnedFiles(adapter, cwd);
    return result;
  } finally { await rm(temp, { recursive: true, force: true }); }
}

export async function runVerification(options) {
  if (options.allowCommand !== true) invalid('command-consent-required');
  if (typeof options.cwd !== 'string' || !options.cwd) invalid('explicit-working-directory-required');
  const cwd = await realpath(resolve(options.cwd)).catch(() => { invalid('working-directory-unavailable'); });
  if (!(await lstat(cwd)).isDirectory()) invalid('working-directory-unavailable');
  if (typeof options.sourcePath !== 'string' || !options.sourcePath) invalid('local-source-required');
  if (typeof options.oraclePath !== 'string' || !options.oraclePath) invalid('oracle-configuration-required');
  const oracle = parseOracleConfiguration(parseBoundedJson(await boundedFile(resolve(options.oraclePath))));
  let inputContract;
  let expectedHashes;
  let configurationHash = options.configurationHash;
  let testSpecHash;
  const source = await boundedFile(resolve(options.sourcePath));
  let ordinary;
  let fixture;
  if (options.packagePath) {
    if (options.contractPath || options.ordinaryPath || options.fixturePath || options.configurationHash) invalid('conflicting-input-options');
    const packageBytes = await boundedFile(resolve(options.packagePath), 262_144);
    const data = parsePackage(parseBoundedJson(packageBytes, { ...JSON_LIMITS, bytes: 262_144, string: 131_072 }));
    inputContract = parseInputContract(data.inputContract);
    if (data.verificationSpec !== undefined || data.testSpecHash !== undefined) {
      const spec = parseVerificationSpec(data.verificationSpec);
      if (typeof data.testSpecHash !== 'string' || !HASH.test(data.testSpecHash) || sha256(canonicalJson(spec)) !== data.testSpecHash) invalid('test-spec-hash-mismatch');
      bindOracleToSpec(oracle, spec);
      testSpecHash = data.testSpecHash;
    }
    configurationHash = data.configurationHash;
    expectedHashes = { sourceHash: data.sourceHash, ordinaryHash: data.ordinaryHash, fixtureHash: data.fixtureHash, contractHash: data.inputContractHash };
    ordinary = Buffer.from(data.ordinaryJson);
    fixture = Buffer.from(data.fixtureJson);
  } else {
    if (!options.contractPath || !options.ordinaryPath || !options.fixturePath) invalid('input-paths-required');
    inputContract = parseInputContract(parseBoundedJson(await boundedFile(resolve(options.contractPath))));
    ordinary = await boundedFile(resolve(options.ordinaryPath));
    fixture = await boundedFile(resolve(options.fixturePath));
  }
  if (typeof configurationHash !== 'string' || !HASH.test(configurationHash)) invalid('configuration-hash-required');
  const hashes = { sourceHash: sha256(source), ordinaryHash: sha256(ordinary), fixtureHash: sha256(fixture), contractHash: inputContractHash(inputContract) };
  if (expectedHashes && Object.keys(expectedHashes).some(key => hashes[key] !== expectedHashes[key])) invalid('package-hash-mismatch');
  // Source bytes are required locally; a public sample cannot silently stand in
  // for the source bound to the prepared package.
  const inputs = { original: source, ordinary, synthetic: fixture };
  const inputValidity = { original: false, ordinary: false, synthetic: false };
  for (const [name, bytes] of Object.entries(inputs)) {
    try {
      parseBoundedJson(bytes);
      inputValidity[name] = validateContractPayload(parseContractPayload(bytes.toString('utf8')), inputContract).valid;
    }
    catch { inputValidity[name] = false; }
  }
  for (const adapter of [oracle.affected, oracle.fixed].filter(Boolean)) await assertPinnedFiles(adapter, cwd);
  const repetitions = oracle.limits?.repetitions ?? 1;
  const report = {
    version: 1, kind: 'reproshare-local-verification', sourceKind: 'provided-local-source', configurationHash,
    ...hashes, oracleHash: sha256(canonicalJson(oracle)), runner: await runnerBinding(),
    adapters: { affected: adapterBinding(oracle.affected), ...(oracle.fixed ? { fixed: adapterBinding(oracle.fixed) } : {}) },
    assertionId: oracle.assertionId, failureKind: oracle.failureKind,
    ...(oracle.failureSite !== undefined ? { failureSite: oracle.failureSite } : {}),
    ...(testSpecHash !== undefined ? { testSpecHash } : {}), inputValidity, repetitions,
    ordinaryControl: inputValidity.ordinary ? 'inconclusive' : 'invalid',
    matrix: {}, verdict: 'rejected', failures: [], scope: 'local-self-report-declared-files-only',
  };
  if (!Object.values(inputValidity).every(Boolean)) report.failures.push('input-contract-rejected');
  if (Object.values(inputValidity).every(Boolean)) {
    const temp = await mkdtemp(join(tmpdir(), 'reproshare-local-'));
    const deadline = Date.now() + (oracle.limits?.maxDurationMs ?? 60_000);
    try {
      for (const [name, revision, input, expected] of CELL_SPECS) {
        const adapter = oracle[revision];
        if (!adapter) continue;
        const inputPath = join(temp, name + '.json');
        await writeFile(inputPath, inputs[input], { mode: 0o600 });
        let result;
        for (let run = 0; run < repetitions; run++) {
          const remaining = deadline - Date.now();
          if (remaining <= 0) { result = { outcome: 'error', matchedExpected: false, errorCode: 'verification-budget-exhausted' }; break; }
          const boundedOracle = { ...oracle, limits: { ...oracle.limits, timeoutMs: Math.min(oracle.limits?.timeoutMs ?? 5_000, remaining) } };
          let observed = await runOracle(adapter.command, inputPath, cwd, temp, boundedOracle, expected);
          try {
            if (sha256(await boundedFile(inputPath)) !== sha256(inputs[input])) observed = { outcome: 'error', matchedExpected: false, errorCode: 'oracle-input-mutated' };
          } catch { observed = { outcome: 'error', matchedExpected: false, errorCode: 'oracle-input-mutated' }; }
          if (result && canonicalJson(result) !== canonicalJson(observed)) { result = { outcome: 'error', matchedExpected: false, errorCode: 'oracle-flaky' }; break; }
          result = observed;
          if (observed.outcome === 'error') break;
        }
        report.matrix[name] = result;
        if ((!result.matchedExpected && name !== 'ordinary') || result.errorCode === 'oracle-input-mutated') report.failures.push(name + ':' + (result.errorCode ?? 'unexpected-outcome'));
      }
      try { for (const adapter of [oracle.affected, oracle.fixed].filter(Boolean)) await assertPinnedFiles(adapter, cwd); }
      catch { report.failures.push('adapter-files-changed-during-run'); }
    } finally { await rm(temp, { recursive: true, force: true }); }
  }
  const control = report.matrix.ordinary;
  if (control) report.ordinaryControl = control.outcome === 'pass' ? 'hides-failure' : control.outcome === 'fail' ? 'preserves-failure'
    : ['assertion-mismatch', 'failure-kind-mismatch', 'failure-site-mismatch'].includes(control.errorCode) ? 'different-failure' : 'inconclusive';
  if (report.matrix.original?.outcome === 'fail' && report.matrix.synthetic?.outcome === 'fail'
    && report.matrix.original.failureSite !== report.matrix.synthetic.failureSite) report.failures.push('failure-site-mismatch');
  const required = oracle.fixed ? ['original', 'synthetic', 'fixedOriginal', 'fixedOrdinary', 'fixedSynthetic'] : ['original', 'synthetic'];
  if (report.failures.length === 0 && required.every(name => report.matrix[name]?.matchedExpected)) {
    report.verdict = 'verified';
    report.evidenceLevel = oracle.fixed ? 'fix-validated' : 'failure-reproduced';
  }
  return { ...report, evidenceHash: evidenceHash(report) };
}
