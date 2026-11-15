import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { parseServiceProfile, synthesizeWorkflow, hasPrivateValue } from '../../local/workflow.mjs';
import { buildPortableRunner } from '../../local/portable.mjs';
import { importSchema } from '../../local/schema-import.mjs';
import { sha256 } from '../../local/protocol.mjs';
import { validateContractPayload } from '../../src/domain/input-contract';

const directories: string[] = [];
const entropyControl = vi.hoisted(() => ({ fixed: null as number | null }));
vi.mock('node:crypto', async importOriginal => {
  const original = await importOriginal<typeof import('node:crypto')>();
  return { ...original, randomBytes: (size: number) => entropyControl.fixed === null ? original.randomBytes(size) : Buffer.alloc(size, entropyControl.fixed) };
});
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

// Authored protocol acceptance fixture, not an upstream bug or independent user trial.
const adapter = `import {readFileSync} from 'node:fs';
const input=JSON.parse(readFileSync(process.argv[2],'utf8'));
const result={version:1,assertionId:'example.reference-length.v1',outcome:'pass'};
if(input.reference.length>32) Object.assign(result,{outcome:'fail',failureKind:'reference-truncated',failureSite:'import.identity-key.v1'});
console.log(JSON.stringify(result));\n`;
const schema = { type: 'object', additionalProperties: false, required: ['reference'], properties: {
  reference: { type: 'string', minLength: 1, maxLength: 80 },
  email: { type: 'string', format: 'email' },
  comments: { type: 'array', minItems: 0, maxItems: 20, items: { type: 'string', maxLength: 100 } },
} };
async function setup() {
  const cwd = await mkdtemp(join(tmpdir(), 'reproshare-workflow-test-'));
  directories.push(cwd);
  await writeFile(join(cwd, 'adapter.mjs'), adapter);
  const profile = parseServiceProfile({ version: 1, id: 'example-import', contract: importSchema(schema),
    oracle: { version: 1, id: 'example-import', assertionId: 'example.reference-length.v1', failureKind: 'reference-truncated', failureSite: 'import.identity-key.v1',
      affected: { revision: 'example-before', command: [process.execPath, 'adapter.mjs', '{input}'], files: [{ path: 'adapter.mjs', sha256: sha256(adapter) }] } },
    budget: { maxRuns: 32, maxDurationMs: 20_000, repeats: 2 } });
  return { cwd, profile };
}

describe('bounded real-oracle search and minimum disclosure', () => {
  it('uses source-independent numeric/integer/date proposals instead of reversible original offsets', async () => {
    const { cwd, profile } = await setup();
    const scalarProperties = {
      numberValue: { type: 'number', minimum: 1, maximum: 100_000_000, integer: true },
      integerValue: { type: 'string', format: 'integer-string', minimum: '1000000000000000', maximum: '9223372036854775807', minLength: 16, maxLength: 19 },
      dateValue: { type: 'string', format: 'date' }, timestamp: { type: 'string', format: 'date-time' },
    };
    const contract = { version: 1, schema: { ...schema, required: ['reference', ...Object.keys(scalarProperties)], properties: { reference: schema.properties.reference, ...scalarProperties } } };
    const configured = parseServiceProfile({ ...profile, contract });
    const first = { reference: 'fictional-long-identity-reference-1234567', numberValue: 12_000_000,
      integerValue: '1111111111111111111', dateValue: '1980-03-12', timestamp: '1980-03-12T13:30:00.000Z' };
    const second = { ...first, numberValue: 13_000_000, integerValue: '2222222222222222222', dateValue: '1992-10-25', timestamp: '1992-10-25T23:10:00.000Z' };
    entropyControl.fixed = 90;
    try {
      const left = await synthesizeWorkflow({ sourceJson: JSON.stringify(first), profile: configured, cwd, allowCommand: true });
      const right = await synthesizeWorkflow({ sourceJson: JSON.stringify(second), profile: configured, cwd, allowCommand: true });
      const leftFixture = JSON.parse(left.fixtureJson); const rightFixture = JSON.parse(right.fixtureJson);
      // With identical private entropy/schema/positions, changing the original
      // amounts or dates cannot change a proposal via original+1/+4years.
      for (const key of Object.keys(scalarProperties)) expect(leftFixture[key], key).toEqual(rightFixture[key]);
      expect(hasPrivateValue(leftFixture, first, configured.contract)).toBe(false);
      expect(hasPrivateValue(rightFixture, second, configured.contract)).toBe(false);
      expect(left.searchSummary.disclosures.join(' ')).toContain('not reversible offsets');
      expect(validateContractPayload(leftFixture, configured.contract).valid).toBe(true);
    } finally { entropyControl.fixed = null; }
  });

  it('retains declared equality through private alias caching while independently proposing constrained scalars', async () => {
    const { cwd, profile } = await setup();
    const scalar = { type: 'number', integer: true, minimum: 1, maximum: 100_000_000 };
    const temporal = { type: 'string', format: 'date' };
    const configured = parseServiceProfile({ ...profile, contract: { version: 1, schema: { type: 'object', additionalProperties: false,
      required: ['reference', 'amount', 'mirror', 'date', 'dateMirror'], properties: { reference: schema.properties.reference, amount: scalar, mirror: scalar, date: temporal, dateMirror: temporal } },
      relations: [{ left: '/amount', operator: 'eq', right: '/mirror' }, { left: '/date', operator: 'eq', right: '/dateMirror' }] } });
    const original = { reference: 'fictional-long-identity-reference-1234567', amount: 123456, mirror: 123456, date: '1985-01-12', dateMirror: '1985-01-12' };
    const result = await synthesizeWorkflow({ sourceJson: JSON.stringify(original), profile: configured, cwd, allowCommand: true });
    const fixture = JSON.parse(result.fixtureJson);
    expect(fixture.amount).toBe(fixture.mirror);
    expect(fixture.date).toBe(fixture.dateMirror);
    expect(fixture.amount).not.toBe(original.amount);
    expect(fixture.date).not.toBe(original.date);
    expect(validateContractPayload(fixture, configured.contract).valid).toBe(true);
  });

  it('uses test feedback outside the catalog, changes private values, removes irrelevant optional data and preserves required input', async () => {
    const { cwd, profile } = await setup();
    const original = { reference: 'customer-private-reference-long-001', email: 'fictional@example.test', comments: ['fictional customer note', 'extra info'] };
    const result = await synthesizeWorkflow({ sourceJson: JSON.stringify(original), profile, cwd, allowCommand: true });
    const fixture = JSON.parse(result.fixtureJson);
    expect(fixture.reference).not.toBe(original.reference);
    expect(fixture.reference.length).toBeGreaterThan(32);
    expect(fixture.email).toBeUndefined();
    expect(fixture.comments).toBeUndefined();
    expect(validateContractPayload(fixture, profile.contract).valid).toBe(true);
    expect(hasPrivateValue(fixture, original, profile.contract)).toBe(false);
    expect(JSON.parse(result.ordinaryJson).reference.length).toBeLessThan(33);
    expect(result.searchSummary.removedParts).toBeGreaterThan(0);
    expect(result.searchSummary.differentOutcomes).toBeGreaterThan(0);
    expect(result.searchSummary.runs).toBeLessThanOrEqual(profile.budget.maxRuns);
    expect(JSON.stringify(result.searchSummary)).not.toContain(original.reference);
    expect(result.verificationSpec.affected.files[0].sha256).toBe(sha256(adapter));
    expect(result.configurationHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('reuses one unchanged service profile across three new failing reports with independent aliases', async () => {
    const { cwd, profile } = await setup();
    const before = JSON.stringify(profile);
    const fixtures = [];
    for (const suffix of ['001', '002', '003']) {
      const result = await synthesizeWorkflow({ sourceJson: JSON.stringify({ reference: 'fictional-import-record-long-key-' + suffix }), profile, cwd, allowCommand: true });
      fixtures.push(result.fixtureJson);
      expect(JSON.parse(result.fixtureJson).reference.length).toBeGreaterThan(32);
    }
    expect(new Set(fixtures).size).toBe(3);
    expect(JSON.stringify(profile)).toBe(before);
    expect(await readFile(join(cwd, 'adapter.mjs'), 'utf8')).toBe(adapter);
  });

  it('refuses a nonfailing original, invalid input, exhausted budgets and lack of command consent', async () => {
    const { cwd, profile } = await setup();
    await expect(synthesizeWorkflow({ sourceJson: '{"reference":"short"}', profile, cwd, allowCommand: true })).rejects.toMatchObject({ code: 'original-failure-not-stable' });
    await expect(synthesizeWorkflow({ sourceJson: '{"reference":42}', profile, cwd, allowCommand: true })).rejects.toMatchObject({ code: 'original-input-invalid' });
    await expect(synthesizeWorkflow({ sourceJson: '{"reference":"a-long-enough-private-reference-123456"}', profile, cwd, allowCommand: false })).rejects.toMatchObject({ code: 'command-consent-required' });
    const controller = new AbortController(); controller.abort();
    await expect(synthesizeWorkflow({ sourceJson: '{"reference":"a-long-enough-private-reference-123456"}', profile, cwd, allowCommand: true, signal: controller.signal })).rejects.toMatchObject({ code: 'search-cancelled' });
  });

  it('does not silently retain a protected singleton value or relax a required schema', async () => {
    const { cwd, profile } = await setup();
    const changed = { ...profile, contract: { version: 1, schema: { type: 'object', properties: { reference: { type: 'string', minLength: 0, maxLength: 0 } }, required: ['reference'], additionalProperties: false } } };
    await expect(synthesizeWorkflow({ sourceJson: '{"reference":""}', profile: changed, cwd, allowCommand: true })).rejects.toMatchObject({ code: 'original-failure-not-stable' });
    expect(() => parseServiceProfile({ ...profile, budget: { maxRuns: 9999 } })).toThrow();
    expect(() => parseServiceProfile({ ...profile, id: 'other-service' })).toThrow('service-oracle-id-mismatch');
  });

  it('refuses when only the exact private literal fails and bounds actual executions', async () => {
    const { cwd, profile } = await setup();
    const value = 'private-literal-only-failure-0001';
    const source = adapter.replace('input.reference.length>32', `input.reference===${JSON.stringify(value)}`);
    await writeFile(join(cwd, 'adapter.mjs'), source);
    const strict = { ...profile, budget: { ...profile.budget, maxRuns: 64 }, oracle: { ...profile.oracle, affected: { ...profile.oracle.affected, files: [{ path: 'adapter.mjs', sha256: sha256(source) }] } } };
    await expect(synthesizeWorkflow({ sourceJson: JSON.stringify({ reference: value }), profile: strict, cwd, allowCommand: true })).rejects.toMatchObject({ code: 'no-safe-failing-variant' });
    const progress: Array<Record<string, number | string>> = [];
    await expect(synthesizeWorkflow({ sourceJson: JSON.stringify({ reference: value }), profile: { ...strict, budget: { ...strict.budget, maxRuns: 8 } }, cwd, allowCommand: true, onProgress: item => progress.push(item) })).rejects.toMatchObject({ code: 'search-budget-exhausted' });
    expect(progress).toHaveLength(8);
  });

  it('refuses inconsistent optional failure sites rather than calling matching broad labels stable', async () => {
    const { cwd, profile } = await setup();
    const source = `import {readFileSync,writeFileSync,existsSync} from 'node:fs';\nconst path='local-counter';const n=existsSync(path)?Number(readFileSync(path,'utf8')):0;writeFileSync(path,String(n+1));\nconsole.log(JSON.stringify({version:1,assertionId:'example.reference-length.v1',outcome:'fail',failureKind:'reference-truncated',failureSite:n%2?'branch.one':'branch.two'}));`;
    await writeFile(join(cwd, 'adapter.mjs'), source);
    const { failureSite: ignored, ...oracle } = profile.oracle;
    const unstable = { ...profile, oracle: { ...oracle, affected: { ...oracle.affected, files: [{ path: 'adapter.mjs', sha256: sha256(source) }] } } };
    await expect(synthesizeWorkflow({ sourceJson: '{"reference":"fictional-long-reference-for-stability"}', profile: unstable, cwd, allowCommand: true })).rejects.toMatchObject({ code: 'original-failure-not-stable' });
  });
});

describe('reviewed portable actual-application package', () => {
  it('runs the actual pinned application assertion without the original, refuses consent/hash mismatches and has no private bindings', async () => {
    const { cwd, profile } = await setup();
    const sourceJson = JSON.stringify({ reference: 'fictional-customer-reference-never-share-001' });
    const result = await synthesizeWorkflow({ sourceJson, profile, cwd, allowCommand: true });
    const portable = await buildPortableRunner({ profile, cwd, fixtureJson: result.fixtureJson, reviewedCode: true, privateSourceJson: sourceJson });
    expect(portable.runner.length).toBeLessThan(140 * 1024);
    expect(portable.runner).not.toContain(JSON.parse(sourceJson).reference);
    expect(portable.runner).not.toContain(sha256(sourceJson));
    expect(portable.runner).not.toContain(result.configurationHash);
    const receiver = await mkdtemp(join(tmpdir(), 'reproshare-recipient-test-'));
    directories.push(receiver);
    await writeFile(join(receiver, 'application-reproducer.mjs'), portable.runner);
    await writeFile(join(receiver, 'fixture.json'), result.fixtureJson);
    const run = spawnSync(process.execPath, ['application-reproducer.mjs', '--allow-command', 'fixture.json'], { cwd: receiver, encoding: 'utf8', timeout: 10_000 });
    expect(run.status, run.stderr).toBe(0);
    expect(JSON.parse(run.stdout).results.affected).toMatchObject({ outcome: 'fail', matchedExpected: true, failureSite: 'import.identity-key.v1' });
    expect(spawnSync(process.execPath, ['application-reproducer.mjs', 'fixture.json'], { cwd: receiver, encoding: 'utf8' }).status).toBe(1);
    await writeFile(join(receiver, 'fixture.json'), '{}');
    const tampered = spawnSync(process.execPath, ['application-reproducer.mjs', '--allow-command', 'fixture.json'], { cwd: receiver, encoding: 'utf8' });
    expect(tampered.status).toBe(1);
    expect(tampered.stderr).toContain('fixture-hash-mismatch');
    await writeFile(join(receiver, 'fixture.json'), result.fixtureJson);
    const checkout = spawnSync(process.execPath, ['application-reproducer.mjs', '--allow-command', 'fixture.json', '--cwd', cwd], { cwd: receiver, encoding: 'utf8', timeout: 10_000 });
    expect(checkout.status, checkout.stderr).toBe(0);
  });

  it('requires reviewed code and rejects original literals or obvious credentials embedded in the adapter', async () => {
    const { cwd, profile } = await setup();
    const fixtureJson = '{"reference":"different-reference-long-enough-001"}';
    await expect(buildPortableRunner({ profile, cwd, fixtureJson, reviewedCode: false })).rejects.toMatchObject({ code: 'portable-code-review-required' });
    const privateValue = 'fictional-secret-value-in-adapter';
    const source = adapter + '\n// ' + privateValue;
    await writeFile(join(cwd, 'adapter.mjs'), source);
    const bad = { ...profile, oracle: { ...profile.oracle, affected: { ...profile.oracle.affected, files: [{ path: 'adapter.mjs', sha256: sha256(source) }] } } };
    await expect(buildPortableRunner({ profile: bad, cwd, fixtureJson, reviewedCode: true, privateSourceJson: JSON.stringify({ reference: privateValue }) })).rejects.toMatchObject({ code: 'private-literal-in-portable-code' });
    const secret = adapter + '\nconst password="fictional-secret-only";';
    await writeFile(join(cwd, 'adapter.mjs'), secret);
    const badSecret = { ...bad, oracle: { ...bad.oracle, affected: { ...bad.oracle.affected, files: [{ path: 'adapter.mjs', sha256: sha256(secret) }] } } };
    await expect(buildPortableRunner({ profile: badSecret, cwd, fixtureJson, reviewedCode: true })).rejects.toMatchObject({ code: 'possible-secret-in-portable-code' });
    const numeric = adapter + '\nconst customerAmount=8675309;';
    await writeFile(join(cwd, 'adapter.mjs'), numeric);
    const badNumeric = { ...bad, oracle: { ...bad.oracle, affected: { ...bad.oracle.affected, files: [{ path: 'adapter.mjs', sha256: sha256(numeric) }] } } };
    await expect(buildPortableRunner({ profile: badNumeric, cwd, fixtureJson, reviewedCode: true, privateSourceJson: '{"reference":"fictional-source-value","amount":8675309}' })).rejects.toMatchObject({ code: 'private-numeric-literal-in-portable-code' });
  });
});

describe('familiar schema import and one-command workflow', () => {
  it('supports a bounded OpenAPI schema pointer, integer fields and explicit public constants; refuses unsupported validation keywords', () => {
    const document = { components: { schemas: { Input: { type: 'object', additionalProperties: false, required: ['id', 'status'], properties: {
      id: { type: 'integer', minimum: 0 }, status: { type: 'string', enum: ['open', 'closed'] },
    } } } } };
    expect(() => importSchema(document, { pointer: '/components/schemas/Input' })).toThrow('public-enum-review-required');
    const contract = importSchema(document, { pointer: '/components/schemas/Input', publicEnums: true });
    expect(validateContractPayload({ id: 1, status: 'open' }, contract).valid).toBe(true);
    expect(validateContractPayload({ id: 1.5, status: 'open' }, contract).valid).toBe(false);
    expect(() => importSchema({ type: 'string', pattern: '[a-z]+' })).toThrow('unsupported-schema-keyword');
    expect(() => importSchema({ type: 'object', properties: {} })).toThrow('closed-object-schema-required');
    expect(() => importSchema(document, { pointer: '/__proto__' })).toThrow('schema-pointer-unavailable');
  });

  it('initialises, runs and exports exact review JSON using only new local directories', async () => {
    const { cwd, profile } = await setup();
    const schemaPath = join(cwd, 'schema.json');
    const oraclePath = join(cwd, 'oracle.json');
    const sourcePath = join(cwd, 'private.json');
    const profilePath = join(cwd, 'profile.json');
    await writeFile(schemaPath, JSON.stringify(schema));
    await writeFile(oraclePath, JSON.stringify(profile.oracle));
    await writeFile(sourcePath, '{"reference":"fictional-reference-long-enough-12345678"}');
    const cli = resolve('scripts/reproshare-workflow.mjs');
    const invoke = (args: string[]) => spawnSync(process.execPath, [cli, ...args], { cwd: resolve('.'), encoding: 'utf8', timeout: 20_000 });
    const init = invoke(['init', '--id', profile.id, '--schema', schemaPath, '--oracle', oraclePath, '--out', profilePath]);
    expect(init.status, init.stderr).toBe(0);
    const results = join(cwd, 'private-results');
    const run = invoke(['run', '--profile', profilePath, '--source', sourcePath, '--cwd', cwd, '--allow-command', '--out', results]);
    expect(run.status, run.stderr).toBe(0);
    const exported = join(cwd, 'reviewed-package');
    const output = invoke(['export', '--profile', profilePath, '--source', sourcePath, '--result', join(results, 'local-result.json'), '--cwd', cwd, '--reviewed-code', '--out', exported]);
    expect(output.status, output.stderr).toBe(0);
    const review = JSON.parse(await readFile(join(exported, 'workflow-review.json'), 'utf8'));
    expect(review.kind).toBe('reproshare-workflow-review');
    expect(review.report.evidenceLevel).toBe('failure-reproduced');
    expect(review.report.testSpecHash).toMatch(/^[a-f0-9]{64}$/);
    expect(review.portableRunner).toContain('portable APPLICATION assertion');
    const rerun = invoke(['run', '--profile', profilePath, '--source', sourcePath, '--cwd', cwd, '--allow-command', '--out', results]);
    expect(rerun.status).toBe(1);
    expect(JSON.parse(await readFile(join(results, 'local-result.json'), 'utf8')).report.verdict).toBe('verified');
    const wrong = JSON.parse(await readFile(join(results, 'local-result.json'), 'utf8'));
    wrong.report.assertionId = 'different.assertion';
    await writeFile(join(cwd, 'wrong-local-result.json'), JSON.stringify(wrong));
    const rejected = invoke(['export', '--profile', profilePath, '--source', sourcePath, '--result', join(cwd, 'wrong-local-result.json'), '--cwd', cwd, '--reviewed-code', '--out', join(cwd, 'bad-export')]);
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain('workflow-result-binding-mismatch');
  });
});
