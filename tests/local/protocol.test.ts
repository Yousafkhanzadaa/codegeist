import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { inputContractHash, parseInputContract, type InputContractV1 } from '../../src/domain/input-contract';
import { evidenceHash, parseOracleConfiguration, runOracleInput, runVerification, sha256, type OracleConfiguration, type VerificationOptions } from '../../local/protocol.mjs';
import { canonicalJson, parseBoundedJson } from '../../local/json.mjs';
import { canonicalInputContract as bundledCanonical, inputContractHash as bundledHash, parseInputContract as bundledParse, validateContractPayload as bundledValidate } from '../../local/input-contract.mjs';
import { validateContractPayload } from '../../src/domain/input-contract';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });
const configurationHash = 'a'.repeat(64);
const original = JSON.stringify({ values: ['1234567890123456789', '1234567890123456790'] });
const ordinary = JSON.stringify({ values: ['42', '43'] });
const fixture = JSON.stringify({ values: ['9007199254740992', '9007199254740993'] });
const contract: InputContractV1 = {
  version: 1,
  schema: { type: 'object', additionalProperties: false, required: ['values'], properties: {
    values: { type: 'array', minItems: 2, maxItems: 32, items: { type: 'string', format: 'integer-string', minimum: '1' } },
  } },
};
// This is a deliberately tiny test adapter, not an upstream application claim.
const adapterSource = String.raw`
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
const [mode, input, extra] = process.argv.slice(2);
const payload = JSON.parse(readFileSync(input, 'utf8'));
const result = {version:1,assertionId:'test.exact-integer.v1',outcome:'pass'};
if (mode === 'timeout') {
  spawn(process.execPath, ['-e', 'setTimeout(()=>require("fs").writeFileSync(process.argv[1],"orphan"),350)', extra], {stdio:'ignore'});
  setInterval(()=>{},1000);
} else if (mode === 'oversize') process.stdout.write('PRIVATE_LOG '.repeat(10000));
else if (mode === 'malformed') process.stdout.write('PRIVATE_LOG not-json');
else if (mode === 'crash') { console.error('PRIVATE_LOG credentials'); process.exitCode=7; }
else {
  if (mode !== 'fixed') {
    const failed = new Set(payload.values).size !== new Set(payload.values.map(Number)).size;
    if (failed) Object.assign(result,{outcome:'fail',failureKind:'precision-collision'});
  }
  if (mode === 'unrelated') Object.assign(result,{outcome:'fail',failureKind:'PRIVATE_LOG-unrelated'});
  if (mode === 'control-other' && result.outcome === 'pass') Object.assign(result,{outcome:'fail',failureKind:'PRIVATE_LOG-unrelated'});
  if (mode === 'site' && result.outcome === 'fail') result.failureSite='import.integer-coercion';
  if (mode === 'wrong-site' && result.outcome === 'fail') result.failureSite='PRIVATE_LOG-wrong-site';
  if (mode === 'flaky') {
    const seen=existsSync(extra);
    writeFileSync(extra,'visited');
    if(seen){result.outcome='pass';delete result.failureKind;}
  }
  if (mode === 'wrong-assertion') result.assertionId='PRIVATE_LOG-other-assertion';
  if (mode === 'mutate') writeFileSync(input,'{}');
  if (mode === 'environment' && process.env.REPROSHARE_TEST_PRIVATE_SECRET) result.assertionId='PRIVATE_LOG-leaked-env';
  if (mode === 'literal' && extra !== '$(touch injection-marker); echo unsafe') result.assertionId='shell-interpolated';
  console.log(JSON.stringify(result));
}
`;

async function setup(mode = 'affected', options: { timeoutMs?: number; maxOutputBytes?: number; extra?: string } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'reproshare-protocol-test-'));
  directories.push(directory);
  const adapterPath = join(directory, 'adapter.mjs');
  await writeFile(adapterPath, adapterSource);
  const command = (choice: string) => [process.execPath, 'adapter.mjs', choice, '{input}', ...(options.extra ? [options.extra] : [])];
  const files = [{ path: 'adapter.mjs', sha256: sha256(adapterSource) }];
  const oracle: OracleConfiguration = {
    version: 1, id: 'test-oracle', assertionId: 'test.exact-integer.v1', failureKind: 'precision-collision',
    affected: { revision: 'test-before-v1', command: command(mode), files },
    fixed: { revision: 'test-fixed-v1', command: command('fixed'), files },
    ...(options.timeoutMs || options.maxOutputBytes ? { limits: { ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}), ...(options.maxOutputBytes ? { maxOutputBytes: options.maxOutputBytes } : {}) } } : {}),
  };
  const paths = { sourcePath: join(directory, 'private.json'), ordinaryPath: join(directory, 'ordinary.json'), fixturePath: join(directory, 'fixture.json'),
    contractPath: join(directory, 'contract.json'), oraclePath: join(directory, 'oracle.json') };
  await Promise.all([writeFile(paths.sourcePath, original), writeFile(paths.ordinaryPath, ordinary), writeFile(paths.fixturePath, fixture),
    writeFile(paths.contractPath, JSON.stringify(contract)), writeFile(paths.oraclePath, JSON.stringify(oracle))]);
  return { directory, oracle, paths, options: { ...paths, cwd: directory, configurationHash, allowCommand: true } satisfies VerificationOptions };
}

describe('explicit local application protocol', () => {
  it('binds a private local source, all six results, contract, prepared configuration and pinned code without publishing values', async () => {
    const { options } = await setup();
    const report = await runVerification(options);
    expect(report.verdict).toBe('verified');
    expect(report.evidenceLevel).toBe('fix-validated');
    expect(report.ordinaryControl).toBe('hides-failure');
    expect(report.sourceKind).toBe('provided-local-source');
    expect(report.sourceHash).toBe(sha256(original));
    expect(report.fixtureHash).toBe(sha256(fixture));
    expect(report.ordinaryHash).toBe(sha256(ordinary));
    expect(report.contractHash).toBe(inputContractHash(contract));
    expect(report.configurationHash).toBe(configurationHash);
    expect(Object.keys(report.matrix)).toHaveLength(6);
    expect(Object.values(report.matrix).every(cell => cell.matchedExpected)).toBe(true);
    expect(report.evidenceHash).toBe(evidenceHash(report));
    expect(evidenceHash({ ...report, fixtureHash: 'b'.repeat(64) })).not.toBe(report.evidenceHash);
    const printed = JSON.stringify(report);
    expect(printed).not.toContain('1234567890123456789');
    expect(printed).not.toContain('9007199254740992');
    expect(printed).not.toContain(options.cwd);
    expect(printed).not.toContain('command');
  });

  it('requires explicit authorization and an explicit chosen directory before executing anything', async () => {
    const { options } = await setup();
    await expect(runVerification({ ...options, allowCommand: false })).rejects.toMatchObject({ code: 'command-consent-required' });
    await expect(runVerification({ ...options, cwd: '' })).rejects.toMatchObject({ code: 'explicit-working-directory-required' });
  });

  it('uses the exported public package and requires the actual local source hash', async () => {
    const { directory, options, paths } = await setup();
    const packagePath = join(directory, 'verification-inputs.json');
    await writeFile(packagePath, JSON.stringify({ version: 1, kind: 'reproshare-verification-inputs', configurationHash,
      sourceHash: sha256(original), ordinaryHash: sha256(ordinary), fixtureHash: sha256(fixture), inputContractHash: inputContractHash(contract),
      ordinaryJson: ordinary, fixtureJson: fixture, inputContract: contract }));
    const packageOptions = { packagePath, sourcePath: paths.sourcePath, oraclePath: paths.oraclePath, cwd: directory, allowCommand: true };
    expect((await runVerification(packageOptions)).verdict).toBe('verified');
    await writeFile(paths.sourcePath, fixture);
    await expect(runVerification(packageOptions)).rejects.toMatchObject({ code: 'package-hash-mismatch' });
    await expect(runVerification({ ...options, packagePath })).rejects.toMatchObject({ code: 'conflicting-input-options' });
  });

  it('requires both original and synthetic to fail the stable assertion and the fix to pass', async () => {
    const { options, paths, oracle } = await setup();
    await writeFile(paths.sourcePath, ordinary);
    const notReproduced = await runVerification(options);
    expect(notReproduced.verdict).toBe('rejected');
    expect(notReproduced.failures).toContain('original:unexpected-outcome');
    await writeFile(paths.sourcePath, original);
    await writeFile(paths.oraclePath, JSON.stringify({ ...oracle, fixed: { ...oracle.fixed, command: oracle.affected.command } }));
    const brokenFix = await runVerification(options);
    expect(brokenFix.verdict).toBe('rejected');
    expect(brokenFix.failures).toContain('fixedSynthetic:unexpected-outcome');
  });

  it('accepts an unfixed matching failure without claiming fix validation', async () => {
    const { options, paths, oracle } = await setup();
    const { fixed: ignored, ...withoutFix } = oracle;
    await writeFile(paths.oraclePath, JSON.stringify(withoutFix));
    const report = await runVerification(options);
    expect(report.verdict).toBe('verified');
    expect(report.evidenceLevel).toBe('failure-reproduced');
    expect(report.failures).toEqual([]);
    expect(report.adapters.fixed).toBeUndefined();
    expect(Object.keys(report.matrix)).toHaveLength(3);
  });

  it('measures an ordinary replacement that also preserves the failure without claiming an advantage', async () => {
    const { options, paths } = await setup();
    await writeFile(paths.ordinaryPath, fixture);
    const report = await runVerification(options);
    expect(report.verdict).toBe('verified');
    expect(report.ordinaryControl).toBe('preserves-failure');
    expect(report.matrix.ordinary).toMatchObject({ outcome: 'fail', assertionId: report.assertionId, matchedExpected: true });
  });

  it('reports a different ordinary failure without mistaking it for matching reproduction', async () => {
    const { options } = await setup('control-other');
    const report = await runVerification(options);
    expect(report.verdict).toBe('verified');
    expect(report.ordinaryControl).toBe('different-failure');
    expect(report.matrix.ordinary).toMatchObject({ outcome: 'error', matchedExpected: false, errorCode: 'failure-kind-mismatch' });
    expect(report.matrix.original?.outcome).toBe('fail');
    expect(report.matrix.synthetic?.outcome).toBe('fail');
    expect(JSON.stringify(report)).not.toContain('PRIVATE_LOG');
  });

  it('binds a package to its predeclared assertion and critical application hashes before execution', async () => {
    const { directory, options, paths, oracle } = await setup();
    const binding = (adapter: typeof oracle.affected) => ({ revision: adapter.revision, files: adapter.files });
    const verificationSpec = { version: 1, id: oracle.id, assertionId: oracle.assertionId, failureKind: oracle.failureKind,
      affected: binding(oracle.affected), fixed: binding(oracle.fixed!) };
    const testSpecHash = sha256(canonicalJson(verificationSpec));
    const packagePath = join(directory, 'bound-inputs.json');
    await writeFile(packagePath, JSON.stringify({ version: 1, kind: 'reproshare-verification-inputs', configurationHash,
      sourceHash: sha256(original), ordinaryHash: sha256(ordinary), fixtureHash: sha256(fixture), inputContractHash: inputContractHash(contract),
      ordinaryJson: ordinary, fixtureJson: fixture, inputContract: contract, verificationSpec, testSpecHash }));
    const opts = { packagePath, sourcePath: paths.sourcePath, oraclePath: paths.oraclePath, cwd: directory, allowCommand: true };
    const report = await runVerification(opts);
    expect(report.verdict).toBe('verified');
    expect(report.testSpecHash).toBe(testSpecHash);
    await writeFile(paths.oraclePath, JSON.stringify({ ...oracle, assertionId: 'unrelated.assertion' }));
    await expect(runVerification(opts)).rejects.toMatchObject({ code: 'oracle-test-spec-mismatch' });
    await writeFile(paths.oraclePath, JSON.stringify({ ...oracle, affected: { ...oracle.affected, files: [{ path: 'adapter.mjs', sha256: '0'.repeat(64) }] } }));
    await expect(runVerification(opts)).rejects.toMatchObject({ code: 'oracle-test-spec-mismatch' });
  });

  it('requires a matching privacy-safe failure site when one was declared', async () => {
    const { options, paths, oracle } = await setup('site');
    await writeFile(paths.oraclePath, JSON.stringify({ ...oracle, failureSite: 'import.integer-coercion' }));
    const correct = await runVerification(options);
    expect(correct.verdict).toBe('verified');
    expect(correct.matrix.synthetic?.failureSite).toBe('import.integer-coercion');
    await writeFile(paths.oraclePath, JSON.stringify({ ...oracle, failureSite: 'import.other-branch' }));
    const mismatch = await runVerification(options);
    expect(mismatch.verdict).toBe('rejected');
    expect(mismatch.matrix.original?.errorCode).toBe('failure-site-mismatch');
    expect(JSON.stringify(mismatch)).not.toContain('PRIVATE_LOG');
  });

  it('rejects an undeclared failure site rather than changing the test identity after execution', async () => {
    const { options } = await setup('site');
    const report = await runVerification(options);
    expect(report.verdict).toBe('rejected');
    expect(report.matrix.original?.errorCode).toBe('failure-site-not-declared');
    expect(report.matrix.synthetic?.errorCode).toBe('failure-site-not-declared');
    expect(report.failureSite).toBeUndefined();
    expect(JSON.stringify(report)).not.toContain('import.integer-coercion');
  });

  it('rejects inconsistent repeated outcomes and enforces an overall execution budget', async () => {
    const first = await setup();
    const marker = join(first.directory, 'flaky-marker');
    const { options, paths, oracle } = await setup('flaky', { extra: marker });
    await writeFile(paths.oraclePath, JSON.stringify({ ...oracle, limits: { repetitions: 2 } }));
    const report = await runVerification(options);
    expect(report.verdict).toBe('rejected');
    expect(report.repetitions).toBe(2);
    expect(report.matrix.original?.errorCode).toBe('oracle-flaky');
    const slow = await setup('timeout', { timeoutMs: 5_000, extra: join(first.directory, 'slow-marker') });
    await writeFile(slow.paths.oraclePath, JSON.stringify({ ...slow.oracle, limits: { timeoutMs: 5_000, maxDurationMs: 100 } }));
    const budget = await runVerification(slow.options);
    expect(budget.verdict).toBe('rejected');
    expect(budget.failures.some(code => code.includes('verification-budget-exhausted'))).toBe(true);
  });

  it('offers the same pinned, explicitly authorised observed-result primitive to bounded search', async () => {
    const { directory, oracle } = await setup('site');
    const configured = { ...oracle, failureSite: 'import.integer-coercion' };
    await expect(runOracleInput({ oracle: configured, cwd: directory, input: original, allowCommand: false })).rejects.toMatchObject({ code: 'command-consent-required' });
    expect(await runOracleInput({ oracle: configured, cwd: directory, input: original, allowCommand: true })).toMatchObject({ outcome: 'fail', matchedExpected: true, failureSite: 'import.integer-coercion' });
    expect(await runOracleInput({ oracle: configured, cwd: directory, input: ordinary, allowCommand: true })).toMatchObject({ outcome: 'pass', matchedExpected: true });
    await writeFile(join(directory, 'adapter.mjs'), adapterSource + '\n// changed');
    await expect(runOracleInput({ oracle: configured, cwd: directory, input: original, allowCommand: true })).rejects.toMatchObject({ code: 'adapter-hash-mismatch' });
  });

  it.each([['malformed', 'malformed-oracle-result'], ['crash', 'oracle-nonzero-exit'], ['unrelated', 'failure-kind-mismatch'], ['wrong-assertion', 'assertion-mismatch'], ['mutate', 'oracle-input-mutated']] as const)(
    'rejects %s without leaking stdout, stderr or unrelated result values', async (mode, errorCode) => {
      const { options } = await setup(mode);
      const report = await runVerification(options);
      expect(report.verdict).toBe('rejected');
      expect(report.matrix.original).toMatchObject({ outcome: 'error', matchedExpected: false, errorCode });
      expect(JSON.stringify(report)).not.toContain('PRIVATE_LOG');
    });

  it('caps combined stdout and stderr without preserving their content', async () => {
    const { options } = await setup('oversize', { maxOutputBytes: 128 });
    const report = await runVerification(options);
    expect(report.matrix.original?.errorCode).toBe('oracle-output-limit');
    expect(JSON.stringify(report)).not.toContain('PRIVATE_LOG');
  });

  it('kills a timed out process group, including the adapter child', async () => {
    const initial = await setup();
    const marker = join(initial.directory, 'orphan-marker');
    const { options } = await setup('timeout', { timeoutMs: 100, extra: marker });
    const report = await runVerification(options);
    expect(report.matrix.original?.errorCode).toBe('oracle-timeout');
    await new Promise(done => setTimeout(done, 500));
    await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('passes literal argv without shell expansion and strips inherited secrets', async () => {
    const literal = await setup('literal', { extra: '$(touch injection-marker); echo unsafe' });
    expect((await runVerification(literal.options)).verdict).toBe('verified');
    await expect(readFile(join(literal.directory, 'injection-marker'))).rejects.toMatchObject({ code: 'ENOENT' });
    const environment = await setup('environment');
    process.env.REPROSHARE_TEST_PRIVATE_SECRET = 'do-not-forward';
    try { expect((await runVerification(environment.options)).verdict).toBe('verified'); }
    finally { delete process.env.REPROSHARE_TEST_PRIVATE_SECRET; }
  });

  it('rejects symlinked or changed pinned files before invoking the oracle', async () => {
    const { options, paths, directory, oracle } = await setup();
    await writeFile(join(directory, 'adapter.mjs'), adapterSource + '\n// changed');
    await expect(runVerification(options)).rejects.toMatchObject({ code: 'adapter-hash-mismatch' });
    await symlink(paths.sourcePath, join(directory, 'linked.mjs'));
    await writeFile(paths.oraclePath, JSON.stringify({ ...oracle, affected: { ...oracle.affected, command: [process.execPath, 'linked.mjs', '{input}'], files: [{ path: 'linked.mjs', sha256: sha256(original) }] } }));
    await expect(runVerification(options)).rejects.toMatchObject({ code: 'adapter-symlink-rejected' });
  });

  it.each(['{"values":["42","43"],"extra":"PRIVATE_FIELD"}', '{"values":["42",43]}', '{"values":["42","43"],"values":["1","2"]}', '{"values":["9223372036854775808","43"]}'])(
    'validates every array value and strict input structure before running commands', async source => {
      const { options, paths } = await setup('crash');
      await writeFile(paths.sourcePath, source);
      const report = await runVerification(options);
      expect(report.verdict).toBe('rejected');
      expect(report.inputValidity.original).toBe(false);
      expect(report.matrix).toEqual({});
      expect(JSON.stringify(report)).not.toContain('PRIVATE_FIELD');
    });

  it('runs as a dependency-free CLI and refuses to overwrite an existing file', async () => {
    const { options, directory } = await setup();
    const output = join(directory, 'evidence.json');
    const args = ['scripts/reproshare-check.mjs', '--contract', options.contractPath!, '--oracle', options.oraclePath, '--source', options.sourcePath,
      '--ordinary', options.ordinaryPath!, '--fixture', options.fixturePath!, '--cwd', options.cwd, '--configuration-hash', configurationHash, '--allow-command', '--out', output];
    const child = spawnSync(process.execPath, args, { cwd: resolve('.'), encoding: 'utf8', timeout: 15_000 });
    expect(child.status, child.stderr).toBe(0);
    expect(JSON.parse(await readFile(output, 'utf8')).verdict).toBe('verified');
    expect(child.stdout).toBe('ReproShare local verification: verified. Evidence saved.\n');
    expect(child.stderr).toBe('');
    const repeat = spawnSync(process.execPath, args, { cwd: resolve('.'), encoding: 'utf8', timeout: 15_000 });
    expect(repeat.status).toBe(1);
    expect(JSON.parse(await readFile(output, 'utf8')).verdict).toBe('verified');
  });
});

describe('bounded configuration and single-source runtime', () => {
  it('rejects duplicate/prototype keys, invalid Unicode, allocation limits and unbounded numeric values', () => {
    for (const input of ['{"x":1,"x":2}', '{"__proto__":{}}', '"\\ud800"', '1e999']) expect(() => parseBoundedJson(input)).toThrow();
    expect(() => parseBoundedJson('['.repeat(40) + '0' + ']'.repeat(40))).toThrow();
    expect(() => parseBoundedJson(JSON.stringify('x'.repeat(65_536)))).toThrow();
  });
  it('rejects partial placeholders, traversal and unknown config properties', async () => {
    const { oracle } = await setup();
    const malformed = [
      { ...oracle, affected: { ...oracle.affected, command: ['node', 'adapter.mjs', '--input={input}'] } },
      { ...oracle, affected: { ...oracle.affected, files: [{ path: '../adapter.mjs', sha256: 'f'.repeat(64) }] } },
      { ...oracle, secret: 'private' },
      { ...oracle, limits: { timeoutMs: 30_001 } },
      { ...oracle, limits: { repetitions: 4 } },
      { ...oracle, limits: { maxDurationMs: 120_001 } },
      { ...oracle, affected: { ...oracle.affected, files: Array.from({ length: 25 }, (_, index) => ({ path: `file-${index}.mjs`, sha256: 'f'.repeat(64) })) } },
    ];
    malformed.forEach(value => expect(() => parseOracleConfiguration(value)).toThrow());
  });
  it('matches the live TypeScript contract parser, canonical hash and validity behavior', () => {
    const examples = [contract, { version: 1, schema: { type: 'object', properties: { start: { type: 'string', format: 'date' }, end: { type: 'string', format: 'date' } }, required: ['start', 'end'], additionalProperties: false }, relations: [{ left: '/start', operator: 'lte', right: '/end' }] }];
    for (const example of examples) {
      const live = parseInputContract(example);
      const portable = bundledParse(example);
      expect(bundledCanonical(portable)).toBe(canonicalJson(live));
      expect(bundledHash(portable)).toBe(inputContractHash(live));
      for (const payload of [JSON.parse(original), JSON.parse(ordinary), {}, { start: '2024-02-29', end: '2024-03-01' }, { start: '2024-02-30', end: '2024-03-01' }]) {
        expect(bundledValidate(payload, portable)).toEqual(validateContractPayload(payload, live));
      }
    }
  });
});
