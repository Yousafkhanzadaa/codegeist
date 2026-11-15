#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { exerciseHttpImport, checkImport } from '../examples/heldout/adapter.mjs';
import { runVerification, sha256 } from '../local/protocol.mjs';
import { buildPortableRunner } from '../local/portable.mjs';
import { verificationSpecForProfile } from '../local/workflow.mjs';
import { canonicalJson } from '../local/json.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = join(root, 'examples/heldout');
const hash = value => createHash('sha256').update(value).digest('hex');
const safeCode = error => /^[a-z][a-z0-9-]{0,79}$/.test(error?.code ?? '') ? error.code : 'evaluation-step-failed';

async function assertManifest(path) {
  const manifest = JSON.parse(await readFile(join(base, path), 'utf8'));
  for (const file of manifest.files) if (hash(await readFile(join(base, file.path))) !== file.sha256) throw Error('frozen-file-changed:' + file.path);
  return manifest;
}

async function main() {
  const args = process.argv.slice(2);
  let output; let engine = 'frozen'; let selected; let round = 'regression';
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--out' && !output) output = args[++index];
    else if (flag === '--engine' && ['frozen', 'current'].includes(args[index + 1])) engine = args[++index];
    else if (flag === '--task' && !selected && /^T0[1-6]$/.test(args[index + 1])) selected = args[++index];
    else if (flag === '--round' && ['first-seen', 'regression'].includes(args[index + 1])) round = args[++index];
    else throw Error('usage: --out NEW_DIRECTORY [--engine frozen|current] [--task T01..T06] [--round first-seen|regression]');
  }
  if (!output) throw Error('output-directory-required');
  const out = resolve(output);
  await mkdir(out); // Never overwrite a prior evaluation or original input.
  const freeze = await assertManifest('freeze.json');
  await assertManifest('engine-snapshot.json');
  const taskSet = JSON.parse(await readFile(join(base, 'tasks.json'), 'utf8'));
  const enginePath = engine === 'frozen' ? join(base, 'engine-snapshot/workflow.mjs') : join(root, 'local/workflow.mjs');
  const { synthesizeWorkflow, hasPrivateValue } = await import(pathToFileURL(enginePath).href);
  const report = {
    version: 1, kind: 'reproshare-agent-authored-acceptance-evaluation', startedAt: new Date().toISOString(),
    scope: 'authored-local-http-application; no independent-human-trial; no upstream-vulnerability-claim',
    mode: round === 'first-seen' && engine === 'frozen' ? 'first-seen-engine-snapshot' : 'seen-task-regression',
    engineSelection: engine,
    engineHash: hash(await readFile(enginePath)), engineAtTaskFreeze: freeze.engineAtFreeze.sha256,
    freezeHash: hash(await readFile(join(base, 'freeze.json'))), runtime: process.version,
    profileReuse: 'T01,T02,T03 use byte-identical profile.json without adapter or generator edits', tasks: [],
  };
  for (const task of taskSet.tasks.filter(task => !selected || task.id === selected)) {
    const started = Date.now();
    const sourceJson = await readFile(join(base, task.fixture), 'utf8');
    const profile = JSON.parse(await readFile(join(base, task.profile), 'utf8'));
    const payload = JSON.parse(sourceJson);
    const row = { id: task.id, expected: task.expected, sourceFixtureHash: hash(sourceJson), profileHash: hash(JSON.stringify(profile)), attempts: [], passed: false };
    const affected = await exerciseHttpImport(payload);
    const fixed = await exerciseHttpImport(payload, { fixed: true });
    row.originalApplication = { affectedStatus: affected.status, fixedStatus: fixed.status,
      affectedAssertion: await checkImport(payload, { fixed: false }), fixedAssertion: await checkImport(payload, { fixed: true }) };
    const taskDirectory = join(out, task.id); await mkdir(taskDirectory);
    let lastProgress;
    try {
      const result = await synthesizeWorkflow({ sourceJson, profile, cwd: root, allowCommand: true, onProgress: progress => { lastProgress = progress; } });
      row.attempts.push({ kind: 'bounded-search', outcome: 'reproduced', searchSummary: result.searchSummary });
      const synthetic = JSON.parse(result.fixtureJson);
      const leaksPrivateValue = hasPrivateValue(synthetic, payload, profile.contract);
      row.privateScalarOverlap = leaksPrivateValue;
      await writeFile(join(taskDirectory, 'fixture.json'), result.fixtureJson, { flag: 'wx' });
      await writeFile(join(taskDirectory, 'ordinary.json'), result.ordinaryJson, { flag: 'wx' });
      await writeFile(join(taskDirectory, 'oracle.json'), JSON.stringify(profile.oracle, null, 2), { flag: 'wx' });
      const inputPackage = { version: 1, kind: 'reproshare-verification-inputs', configurationHash: result.configurationHash,
        sourceHash: sha256(sourceJson), fixtureHash: sha256(result.fixtureJson), ordinaryHash: sha256(result.ordinaryJson),
        inputContractHash: result.inputContractHash, fixtureJson: result.fixtureJson, ordinaryJson: result.ordinaryJson,
        inputContract: result.inputContract, verificationSpec: result.verificationSpec, testSpecHash: result.testSpecHash };
      const packagePath = join(taskDirectory, 'private-verification-inputs.json');
      await writeFile(packagePath, JSON.stringify(inputPackage, null, 2), { flag: 'wx', mode: 0o600 });
      const evidence = await runVerification({ sourcePath: join(base, task.fixture), oraclePath: join(taskDirectory, 'oracle.json'), packagePath, cwd: root, allowCommand: true });
      row.reproduction = { verdict: evidence.verdict, evidenceLevel: evidence.evidenceLevel, ordinaryControl: evidence.ordinaryControl, failures: evidence.failures, matrix: evidence.matrix };
      row.attempts.push({ kind: 'pre-fix-verification', outcome: evidence.verdict });
      const portable = await buildPortableRunner({ profile, cwd: root, fixtureJson: result.fixtureJson, reviewedCode: true, privateSourceJson: sourceJson });
      const runnerPath = join(taskDirectory, 'application-reproducer.mjs');
      await writeFile(runnerPath, portable.runner, { flag: 'wx' });
      const recipient = spawnSync(process.execPath, [runnerPath, '--allow-command', join(taskDirectory, 'fixture.json')], { cwd: taskDirectory, encoding: 'utf8', timeout: 15_000,
        env: { PATH: process.env.PATH ?? '/usr/bin:/bin' }, maxBuffer: 65_536 });
      let recipientResult;
      try { recipientResult = JSON.parse(recipient.stdout); } catch { recipientResult = null; }
      row.recipient = { exitCode: recipient.status, runnerHash: portable.runnerHash, result: recipientResult,
        privateOriginalAvailable: false, scope: 'fresh temporary embedded application; no original fixture passed to runner' };
      row.attempts.push({ kind: 'recipient-synthetic-only-replay', outcome: recipient.status === 0 ? 'reproduced' : 'failed' });
      const fixedProfile = JSON.parse(await readFile(join(base, 'profile-fixed.json'), 'utf8'));
      const fixedSpec = verificationSpecForProfile(fixedProfile);
      const fixedPackagePath = join(taskDirectory, 'private-fix-verification-inputs.json');
      const fixedOraclePath = join(taskDirectory, 'oracle-fixed.json');
      await writeFile(fixedOraclePath, JSON.stringify(fixedProfile.oracle, null, 2), { flag: 'wx' });
      await writeFile(fixedPackagePath, JSON.stringify({ ...inputPackage, verificationSpec: fixedSpec,
        configurationHash: hash(result.configurationHash + ':optional-fix'), testSpecHash: hash(canonicalJson(fixedSpec)) }, null, 2), { flag: 'wx', mode: 0o600 });
      const fixedEvidence = await runVerification({ sourcePath: join(base, task.fixture), oraclePath: fixedOraclePath, packagePath: fixedPackagePath, cwd: root, allowCommand: true });
      row.optionalFix = { verdict: fixedEvidence.verdict, evidenceLevel: fixedEvidence.evidenceLevel, failures: fixedEvidence.failures, matrix: fixedEvidence.matrix };
      row.attempts.push({ kind: 'optional-fix-validation', outcome: fixedEvidence.verdict });
      row.passed = task.expected === 'reproduce' && evidence.verdict === 'verified' && evidence.evidenceLevel === 'failure-reproduced'
        && recipient.status === 0 && recipientResult?.results?.affected?.outcome === 'fail' && !leaksPrivateValue
        && fixedEvidence.verdict === 'verified' && fixedEvidence.evidenceLevel === 'fix-validated';
    } catch (error) {
      const code = safeCode(error);
      row.attempts.push({ kind: 'pipeline', outcome: 'refused-or-failed', code, ...(lastProgress ? { lastProgress } : {}) });
      row.passed = task.expected === 'refuse-original-passes' ? code === 'original-failure-not-stable'
        : task.expected === 'refuse-invalid-source' ? code === 'original-input-invalid'
        : task.expected === 'refuse-no-safe-variant' ? ['no-safe-failing-variant', 'search-budget-exhausted'].includes(code) : false;
    }
    row.elapsedMs = Date.now() - started;
    report.tasks.push(row);
    // Every completed task is checkpointed, even when later tasks fail.
    await writeFile(join(out, 'evaluation.json'), JSON.stringify(report, null, 2) + '\n');
    process.stdout.write(`${task.id}: ${row.passed ? 'expected result' : 'unexpected result'} (${row.elapsedMs}ms)\n`);
  }
  report.summary = { total: report.tasks.length, expectedOutcomes: report.tasks.filter(task => task.passed).length,
    positiveTasks: report.tasks.filter(task => task.expected === 'reproduce').length,
    positiveCompleted: report.tasks.filter(task => task.expected === 'reproduce' && task.passed).length,
    negativeTasks: report.tasks.filter(task => task.expected !== 'reproduce').length,
    negativeCorrectRefusals: report.tasks.filter(task => task.expected !== 'reproduce' && task.passed).length };
  report.completedAt = new Date().toISOString();
  await writeFile(join(out, 'evaluation.json'), JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify(report.summary) + '\n');
  if (report.summary.expectedOutcomes !== report.summary.total) process.exitCode = 2;
}

main().catch(error => { process.stderr.write(String(error.message ?? 'evaluation-unavailable') + '\n'); process.exitCode = 1; });
