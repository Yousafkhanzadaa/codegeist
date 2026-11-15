import type { ApplicationCase, PreparedRepro } from '../shared/contracts';
import { PayloadError, type JsonValue } from './json';
import { HERMES_ADAPTER, HERMES_FILES } from './hermes-bundle';

export const HERMES_CASE: ApplicationCase = {
  id: 'hermes-integer-coercion',
  title: 'Hermes Agent: integer tool arguments lose precision',
  issueUrl: 'https://github.com/NousResearch/hermes-agent/issues/55314',
  fixUrl: 'https://github.com/NousResearch/hermes-agent/pull/40763',
  affectedRevision: 'c79e3fd0baf41c0adda616b73153eeaa8a4b8231',
  proposedFixRevision: '097c9185aeb69cc302f660f1d5c8553e4fcbaedb',
  entrypoint: 'model_tools.coerce_tool_args',
  inputContract: 'Only calls[].chat_id; 2–32 calls; each ID is a canonical positive 16–19 digit decimal string no larger than 9223372036854775807.',
  requirements: ['Node.js 22 or later', 'Python 3.11 or later (python3, or set REPROSHARE_PYTHON)', 'Offline: complete pinned MIT sources and license notices are embedded; no provider keys or packages required.'],
  scope: 'Imports the complete unchanged upstream coercion module, registry and toolsets in an isolated Python process. Registers the upstream regression probe schema. Calls argument coercion only; no model, tool handler, Discord operation or full agent session runs. The fixed revision is an open proposed upstream fix, not a released fix. The default original vector uses the reported public ID plus an adjacent regression expansion; use --source for a private local source instead.',
  status: 'runner-ready',
};

export function assertApplicationInput(root: JsonValue): void {
  if (!root || typeof root !== 'object' || Array.isArray(root) || Object.keys(root).length !== 1 || !Array.isArray(root.calls)
    || root.calls.length < 2 || root.calls.length > 32) throw new PayloadError('The Hermes case requires only a calls array with 2–32 entries. Load the public application example again.');
  for (const call of root.calls) {
    if (!call || typeof call !== 'object' || Array.isArray(call) || Object.keys(call).length !== 1 || typeof call.chat_id !== 'string'
      || !/^[1-9]\d{15,18}$/.test(call.chat_id) || BigInt(call.chat_id) > (1n << 63n) - 1n) {
      throw new PayloadError('Each Hermes call must contain only chat_id as a positive, canonical 16–19 digit signed-64-bit decimal string.');
    }
  }
}

function applicationHarness(repro: PreparedRepro): string {
  // The public baseline is explicit; arbitrary private source values never enter
  // this exported script. --source reads such a source locally when requested.
  const config = {
    case: HERMES_CASE, fixtureHash: repro.fixtureHash,
    original: { calls: [{ chat_id: '1234567890123456789' }, { chat_id: '1234567890123456790' }] },
    ordinaryJson: repro.ordinaryJson, files: HERMES_FILES, adapter: HERMES_ADAPTER,
  };
  return '// ReproShare offline upstream application regression.\n'
    + '// Upstream source: MIT, Copyright (c) 2025 Nous Research; full notices embedded.\n'
    + '// Run: node repro.mjs fixture.json [--source private-local-source.json]\n'
    + '// No provider key/network access. Executes pinned source in isolated Python.\n'
    + "import assert from 'node:assert/strict';\nimport { createHash } from 'node:crypto';\nimport { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs';\nimport { tmpdir } from 'node:os';\nimport { join, dirname, resolve } from 'node:path';\nimport { spawnSync } from 'node:child_process';\nimport { gunzipSync } from 'node:zlib';\n"
    + `const packageData = ${JSON.stringify(config)};\n` + String.raw`
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--inspect') {
  console.log(JSON.stringify({ case: packageData.case, fixtureHash: packageData.fixtureHash,
    files: Object.fromEntries(Object.entries(packageData.files).map(([name, file]) => [name, file.sha256])),
    license: 'MIT, Copyright (c) 2025 Nous Research; full notices included inside each revision.' }, null, 2));
  process.exit(0);
}
if (args.length !== 1 && !(args.length === 3 && args[1] === '--source')) {
  throw Error('Usage: node repro.mjs fixture.json [--source private-local-source.json]; or --inspect');
}
const fixturePath = resolve(args[0]);
assert.ok(statSync(fixturePath).size <= 65536, 'Fixture exceeds 64 KiB');
const fixtureBytes = readFileSync(fixturePath);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(hash(fixtureBytes), packageData.fixtureHash, 'Fixture hash differs');
if (args[2]) assert.ok(statSync(resolve(args[2])).size <= 65536, 'Source exceeds 64 KiB');
const temp = mkdtempSync(join(tmpdir(), 'reproshare-hermes-'));
try {
  for (const [name, file] of Object.entries(packageData.files)) {
    assert.match(name, /^(before|fixed)\/(model_tools\.py|toolsets\.py|tools\/(__init__|registry)\.py|LICENSE)$/);
    const bytes = gunzipSync(Buffer.from(file.gzip, 'base64'), { maxOutputLength: 200000 });
    assert.equal(hash(bytes), file.sha256, 'Pinned upstream source hash differs: ' + name);
    const target = join(temp, name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes, { mode: 0o600 });
  }
  const adapterPath = join(temp, 'adapter.py');
  writeFileSync(adapterPath, packageData.adapter, { mode: 0o600 });
  const originalPath = args[2] ? resolve(args[2]) : join(temp, 'public-original.json');
  if (!args[2]) writeFileSync(originalPath, JSON.stringify(packageData.original), { mode: 0o600 });
  const ordinaryPath = join(temp, 'ordinary.json');
  writeFileSync(ordinaryPath, packageData.ordinaryJson, { mode: 0o600 });
  const python = process.env.REPROSHARE_PYTHON || 'python3';
  const version = spawnSync(python, ['-I', '-S', '-c', 'import sys; raise SystemExit(0 if sys.version_info >= (3,11) else 1)'],
    { encoding: 'utf8', timeout: 10000, maxBuffer: 65536 });
  if (version.error || version.status !== 0) throw Error('Python 3.11+ is required. Set REPROSHARE_PYTHON to its executable path if needed.');
  const run = (revision, path) => {
    const child = spawnSync(python, ['-I', '-S', adapterPath, join(temp, revision), path],
      { cwd: temp, encoding: 'utf8', timeout: 20000, maxBuffer: 262144 });
    if (child.error || ![0, 1].includes(child.status)) throw Error('Isolated upstream runner did not complete. No application result accepted.');
    let result;
    try { result = JSON.parse(child.stdout); }
    catch { throw Error('Upstream input validation or runtime setup failed. No application result accepted.'); }
    assert.equal(result.entrypoint, packageData.case.entrypoint);
    assert.equal(result.assertion, 'each registered integer tool argument equals its exact input integer');
    assert.equal(result.toolHandlerExecuted, false);
    assert.equal(result.passed, child.status === 0);
    return result;
  };
  const results = Object.fromEntries([['original', originalPath], ['ordinary', ordinaryPath], ['synthetic', fixturePath]]
    .map(([label, path]) => [label, { affected: run('before', path), proposedFix: run('fixed', path) }]));
  for (const label of ['original', 'synthetic']) {
    assert.equal(results[label].affected.passed, false, label + ': affected revision must fail the exact-integer assertion');
    assert.ok(results[label].affected.observedDistinct < results[label].affected.expectedDistinct, label + ': same collision failure must be observed');
    assert.equal(results[label].proposedFix.passed, true, label + ': proposed fix must pass that same assertion');
  }
  assert.equal(results.ordinary.affected.passed, true, 'Ordinary aliases should erase this failure');
  assert.equal(results.ordinary.proposedFix.passed, true);
  console.log(JSON.stringify({ caseId: packageData.case.id, fixtureHash: packageData.fixtureHash,
    affectedRevision: packageData.case.affectedRevision, proposedFixRevision: packageData.case.proposedFixRevision,
    proposedFixStatus: 'open upstream proposal; not a released fix',
    sourceKind: args[2] ? 'provided-local-source' : 'public-upstream-regression-baseline',
    originalVectorNote: args[2] ? 'Only read locally; original IDs are not printed.' : 'Reported public ID plus our adjacent regression expansion.',
    assertion: 'each registered integer tool argument equals its exact input integer',
    sameFailureRetained: true, proposedFixPasses: true, results,
    scope: packageData.case.scope }, null, 2));
} finally {
  rmSync(temp, { recursive: true, force: true });
}
`;
}

export function attachApplicationCase(repro: PreparedRepro): PreparedRepro {
  const limits = [
    'Forge preparation verifies the selected relation in reference handlers. The real pinned Hermes regression runs only when you execute the downloaded harness locally.',
    'Application scope is the unchanged Hermes argument-coercion entry point and its upstream probe schema. No tool handler, model, message delivery or full agent session is executed.',
    'The compared fix is an open proposed upstream change, not a released fix.',
    'The harness includes a clearly labelled public upstream baseline plus our adjacent regression expansion. It never embeds arbitrary private source values; --source reads an original locally without printing its IDs.',
    ...repro.limits.slice(1),
  ];
  const caseRepro = { ...repro, title: 'ReproShare — Hermes integer-coercion regression', applicationCase: { ...HERMES_CASE }, limits };
  return {
    ...caseRepro,
    reportMarkdown: [
      '# Real upstream application regression — runner ready', '',
      `Issue: ${HERMES_CASE.issueUrl}`, `Proposed fix (open, not released): ${HERMES_CASE.fixUrl}`,
      `Affected revision: ${HERMES_CASE.affectedRevision}`, `Proposed fixed revision: ${HERMES_CASE.proposedFixRevision}`,
      `Application entry point: ${HERMES_CASE.entrypoint}`, '',
      HERMES_CASE.inputContract, '',
      'Run the downloaded .mjs harness against the exact fixture with Node.js 22+ and Python 3.11+. The full unchanged MIT source and license notices are embedded. No network, provider key or package installation is required.', '',
      'The runner compares original, ordinary replacement and generated inputs against both pinned application revisions using the same exact-integer assertion. A successful run must show original and synthetic failing on the affected code, ordinary replacements passing, and the proposed fix passing all three.', '',
      'Application status at preparation: RUNNER READY; not executed by Forge. Run the harness to obtain the actual application result. Default original input is the public reported ID plus an adjacent regression expansion; pass --source private-local-source.json to check a private original locally.', '',
      ...limits.map(limit => `- ${limit}`), '',
      '## Preparation checks only', '', repro.reportMarkdown,
    ].join('\n'),
    harnessCode: applicationHarness(caseRepro),
  };
}
