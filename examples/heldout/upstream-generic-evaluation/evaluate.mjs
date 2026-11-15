import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { synthesizeWorkflow, hasPrivateValue } from './engine-snapshot/workflow.mjs';
import { runVerification } from '../../../local/protocol.mjs';

const base = dirname(fileURLToPath(import.meta.url));
const cwd = resolve(base, '../../..');
const hash = text => createHash('sha256').update(text).digest('hex');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const freeze = await json(join(base, 'freeze.json'));
for (const file of freeze.files) if (hash(await readFile(join(base, file.path))) !== file.sha256) throw Error('frozen-file-changed');
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--out') throw Error('usage: --out NEW_DIRECTORY');
const out = resolve(args[1]); await mkdir(out);
const tasks = (await json(join(base, 'tasks.json'))).tasks;
const report = { version: 1, kind: 'reproshare-known-upstream-generic-capability', startedAt: new Date().toISOString(),
  scope: 'Known pinned upstream entry points, not whole customer applications, a blind study or user trials. Generic search only; no bespoke generator.',
  engineHash: hash(await readFile(join(base, 'engine-snapshot/workflow.mjs'))), freezeHash: hash(await readFile(join(base, 'freeze.json'))),
  runtime: process.version, stages: 'generation plus actual original/ordinary/synthetic and fixed local assertions; no portable or Jira lifecycle claim', tasks: [] };
for (const task of tasks) {
  const started = Date.now(); const profile = await json(join(base, task.profile)); const sourceJson = await readFile(join(base, task.fixture), 'utf8');
  const row = { id: task.id, profileId: profile.id, expected: task.expected, sourceHash: hash(sourceJson), profileHash: hash(JSON.stringify(profile)), outcomes: [] };
  let lastProgress;
  try {
    const result = await synthesizeWorkflow({ sourceJson, profile, cwd, allowCommand: true, onProgress: progress => { lastProgress = progress; } });
    row.outcomes.push({ stage: 'generic-search', status: 'candidate-found', summary: result.searchSummary });
    const dir = join(out, task.id); await mkdir(dir);
    const packagePath = join(dir, 'verification-inputs-private.json'); const oraclePath = join(dir, 'oracle.json');
    await writeFile(packagePath, JSON.stringify({ version: 1, kind: 'reproshare-verification-inputs', configurationHash: result.configurationHash,
      sourceHash: hash(sourceJson), fixtureHash: hash(result.fixtureJson), ordinaryHash: hash(result.ordinaryJson), inputContractHash: result.inputContractHash,
      fixtureJson: result.fixtureJson, ordinaryJson: result.ordinaryJson, inputContract: result.inputContract, verificationSpec: result.verificationSpec, testSpecHash: result.testSpecHash }, null, 2), { flag: 'wx', mode: 0o600 });
    await writeFile(oraclePath, JSON.stringify(profile.oracle), { flag: 'wx' });
    const evidence = await runVerification({ packagePath, oraclePath, sourcePath: join(base, task.fixture), cwd, allowCommand: true });
    await writeFile(join(dir, 'fixture.json'), result.fixtureJson, { flag: 'wx' });
    await writeFile(join(dir, 'evidence-private.json'), JSON.stringify(evidence, null, 2), { flag: 'wx', mode: 0o600 });
    row.privateScalarOverlap = hasPrivateValue(JSON.parse(result.fixtureJson), JSON.parse(sourceJson), profile.contract);
    row.outcomes.push({ stage: 'application-verification', status: evidence.verdict, evidenceLevel: evidence.evidenceLevel, matrix: evidence.matrix, failures: evidence.failures });
    row.status = evidence.verdict === 'verified' && !row.privateScalarOverlap ? 'reproduced' : 'rejected-after-search';
  } catch (error) {
    const code = /^[a-z][a-z0-9-]{0,79}$/.test(error?.code ?? '') ? error.code : 'unexpected-evaluation-error';
    row.status = 'refused'; row.outcomes.push({ stage: 'generic-search', status: 'refused', code, ...(lastProgress ? { lastProgress } : {}) });
  }
  row.elapsedMs = Date.now() - started;
  row.expectedNegativeOutcome = task.expected === 'refuse-original-passes' ? row.outcomes.at(-1)?.code === 'original-failure-not-stable'
    : task.expected === 'refuse-invalid-source' ? row.outcomes.at(-1)?.code === 'original-input-invalid' : undefined;
  report.tasks.push(row); await writeFile(join(out, 'evaluation.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`${task.id}: ${row.status} (${row.elapsedMs}ms)`);
}
const positives = report.tasks.filter(task => task.expected === 'attempt-reproduction');
const negatives = report.tasks.filter(task => task.expected !== 'attempt-reproduction');
report.summary = { totalTasks: report.tasks.length, positiveAttempted: positives.length, positiveReproduced: positives.filter(task => task.status === 'reproduced').length,
  positiveRefusedOrRejected: positives.filter(task => task.status !== 'reproduced').length, negativeTasks: negatives.length,
  negativeCorrectRefusals: negatives.filter(task => task.expectedNegativeOutcome).length, falseVerifiedNegatives: negatives.filter(task => task.status === 'reproduced').length,
  unexpectedErrors: report.tasks.filter(task => task.outcomes.some(outcome => outcome.code === 'unexpected-evaluation-error')).length };
report.completedAt = new Date().toISOString();
await writeFile(join(out, 'evaluation.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.summary));
if (report.summary.falseVerifiedNegatives || report.summary.unexpectedErrors || report.summary.negativeCorrectRefusals !== negatives.length) process.exitCode = 2;
