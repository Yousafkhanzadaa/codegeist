// ReproShare offline real-library regression.
// Upstream MIT Copyright (c) 2024 Viva Republica, Inc.
// Full unchanged modules and copyright/license notices are embedded.
// Run: node repro.mjs fixture.json [--source private-local-source.json]
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
const packageData = __REPROSHARE_PACKAGE_DATA__;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--inspect') {
  console.log(JSON.stringify({ case: packageData.case, fixtureHash: packageData.fixtureHash,
    assertionId: packageData.assertionId, fixStatus: 'merged upstream fix',
    files: Object.fromEntries(Object.entries(packageData.files).map(([name, file]) => [name, file.sha256])) }, null, 2));
  process.exit(0);
}
if (Number(process.versions.node.split('.')[0]) < 24) throw Error('Node.js 24+ with built-in TypeScript support is required.');
if (args.length !== 1 && !(args.length === 3 && args[1] === '--source')) throw Error('Usage: node repro.mjs fixture.json [--source private-local-source.json]; or --inspect');
const fixturePath = resolve(args[0]);
assert.ok(statSync(fixturePath).isFile() && statSync(fixturePath).size <= 4096, 'Fixture exceeds the bounded input contract.');
assert.equal(hash(readFileSync(fixturePath)), packageData.fixtureHash, 'Fixture hash differs.');
if (args[2]) assert.ok(statSync(resolve(args[2])).isFile() && statSync(resolve(args[2])).size <= 4096, 'Source exceeds the bounded input contract.');
const temp = mkdtempSync(join(tmpdir(), 'reproshare-deburr-'));
try {
  writeFileSync(join(temp, 'package.json'), '{"type":"module"}', { mode: 0o600 });
  for (const [name, file] of Object.entries(packageData.files)) {
    assert.match(name, /^(?:(affected|fixed)\/(deburr\.ts|LICENSE)|provenance\.json)$/);
    const bytes = gunzipSync(Buffer.from(file.gzip, 'base64'), { maxOutputLength: 20000 });
    assert.equal(hash(bytes), file.sha256, 'Pinned source hash differs.');
    const target = join(temp, name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes, { mode: 0o600 });
  }
  assert.equal(hash(packageData.adapter), packageData.adapterSha256, 'Adapter hash differs.');
  const adapterPath = join(temp, 'adapter.mjs');
  writeFileSync(adapterPath, packageData.adapter, { mode: 0o600 });
  const sourcePath = args[2] ? resolve(args[2]) : join(temp, 'public-original.json');
  if (!args[2]) writeFileSync(sourcePath, JSON.stringify(packageData.original), { mode: 0o600 });
  const ordinaryPath = join(temp, 'ordinary.json');
  writeFileSync(ordinaryPath, packageData.ordinaryJson, { mode: 0o600 });
  const run = (revision, path) => {
    const child = spawnSync(process.execPath, [adapterPath, '--revision', revision, path],
      { cwd: temp, encoding: 'utf8', timeout: 5000, maxBuffer: 16384 });
    if (child.error || child.status !== 0) throw Error('Oracle rejected input or runtime setup; no application result accepted.');
    let result;
    try { result = JSON.parse(child.stdout); } catch { throw Error('Malformed oracle result; no application result accepted.'); }
    assert.equal(result.version, 1);
    assert.equal(result.assertionId, packageData.assertionId);
    assert.ok(['pass', 'fail'].includes(result.outcome));
    assert.deepEqual(Object.keys(result).sort(), (result.outcome === 'fail'
      ? ['version', 'assertionId', 'outcome', 'failureKind'] : ['version', 'assertionId', 'outcome']).sort());
    if (result.outcome === 'fail') assert.equal(result.failureKind, packageData.failureKind);
    return result;
  };
  const results = Object.fromEntries([['original', sourcePath], ['ordinary', ordinaryPath], ['synthetic', fixturePath]]
    .map(([label, path]) => [label, { affected: run('affected', path), fixed: run('fixed', path) }]));
  for (const label of ['original', 'synthetic']) assert.equal(results[label].affected.outcome, 'fail', label + ': affected code must fail the same assertion.');
  assert.equal(results.ordinary.affected.outcome, 'pass', 'Ordinary replacement must erase this failure.');
  for (const label of ['original', 'ordinary', 'synthetic']) assert.equal(results[label].fixed.outcome, 'pass', label + ': merged fix must pass the same assertion.');
  console.log(JSON.stringify({ caseId: packageData.case.id, fixtureHash: packageData.fixtureHash,
    affectedRevision: packageData.case.affectedRevision, fixedRevision: packageData.case.proposedFixRevision,
    fixStatus: 'merged upstream fix', sourceKind: args[2] ? 'provided-local-source' : 'public-upstream-reported-input',
    assertionId: packageData.assertionId, failureKind: packageData.failureKind,
    sameFailureRetained: true, fixedPasses: true, results, scope: packageData.case.scope }, null, 2));
} finally { rmSync(temp, { recursive: true, force: true }); }
