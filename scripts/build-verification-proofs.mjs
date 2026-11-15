// Local-only acceptance proof. No Jira or external API calls.
import { build } from 'vite';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runVerification } from '../local/protocol.mjs';

const temp = await mkdtemp(join(tmpdir(), 'reproshare-verification-build-'));
try {
  const entry = join(temp, 'entry.ts');
  await writeFile(entry, `export { prepareRepro, scanPayload } from ${JSON.stringify(resolve('src/domain/index.ts'))};\nexport { verificationInputs, attachLocalEvidence } from ${JSON.stringify(resolve('src/domain/verification.ts'))};`);
  await build({ configFile: false, logLevel: 'silent', build: { ssr: entry, outDir: join(temp, 'bundle'), emptyOutDir: true, rollupOptions: { output: { entryFileNames: 'entry.mjs' } } } });
  const { prepareRepro, scanPayload, verificationInputs, attachLocalEvidence } = await import(pathToFileURL(join(temp, 'bundle/entry.mjs')).href);
  const summary = [];
  for (const [name, applicationCaseId, sourceFile, oracleFile] of [
    ['hermes', 'hermes-integer-coercion', 'examples/upstream/hermes.json', 'vendor/hermes/oracle.json'],
    ['es-toolkit', 'es-toolkit-deburr', 'examples/upstream/deburr.json', 'vendor/second-case/oracle.json'],
  ]) {
    const sourceJson = await readFile(sourceFile, 'utf8');
    const candidate = scanPayload(sourceJson).candidates.find(item => item.profileId === (name === 'hermes' ? 'precision' : 'diacritics'));
    if (!candidate) throw Error('Application case was not discovered.');
    const repro = prepareRepro({ sourceJson, candidateId: candidate.id, seed: `verification-upgrade-${name}-v1`, applicationCaseId });
    const target = resolve('artifacts/verification-upgrade', name);
    await mkdir(target, { recursive: true });
    await writeFile(join(target, 'original-public.json'), sourceJson);
    await writeFile(join(target, 'verification-inputs.json'), verificationInputs(repro));
    const report = await runVerification({ packagePath: join(target, 'verification-inputs.json'), sourcePath: join(target, 'original-public.json'), oraclePath: resolve(oracleFile), cwd: resolve('.'), allowCommand: true });
    if (report.verdict !== 'verified') throw Error(`Local matrix rejected for ${name}: ${report.failures.join(',')}`);
    const reviewed = attachLocalEvidence(repro, JSON.stringify(report));
    for (const [file, content] of [['fixture.json', reviewed.fixtureJson], ['ordinary.json', reviewed.ordinaryJson], ['repro.mjs', reviewed.harnessCode], ['local-report.json', JSON.stringify(report, null, 2)], ['report.md', reviewed.reportMarkdown]]) await writeFile(join(target, file), content);
    summary.push({ name, applicationCaseId, configurationHash: reviewed.configurationHash, fixtureHash: reviewed.fixtureHash, evidenceHash: report.evidenceHash, verdict: report.verdict, matrix: report.matrix, inputValidity: report.inputValidity, scope: report.scope });
  }
  await writeFile(resolve('artifacts/verification-upgrade/acceptance.json'), JSON.stringify({ version: 1, testedOn: '2026-11-15', execution: 'local-only', jiraWrites: 0, cases: summary }, null, 2));
  process.stdout.write('Both real application cases passed generation, six-cell local execution and bound evidence import. No Jira writes.\n');
} finally { await rm(temp, { recursive: true, force: true }); }
