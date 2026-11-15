#!/usr/bin/env node
// New current-workflow archive only. Never rewrites historical submissions/proofs.
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { readFile, writeFile, copyFile, mkdir, rm, lstat, mkdtemp } from 'node:fs/promises';
import { dirname, resolve, join, basename, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = join(root, 'artifacts/judge-workflow');
const kit = join(artifacts, 'kit');
const archive = join(artifacts, 'kit.zip');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const childEnv = { ...process.env, PATH: dirname(process.execPath) + delimiter + (process.env.PATH ?? '/usr/bin:/bin') };
const files = {};
const include = paths => paths.forEach(path => { files[path] = path; });

include([
  'local/protocol.mjs', 'local/protocol.d.mts', 'local/json.mjs', 'local/json.d.mts', 'local/input-contract.mjs', 'local/input-contract.d.mts',
  'local/workflow.mjs', 'local/workflow.d.mts', 'local/schema-import.mjs', 'local/schema-import.d.mts', 'local/portable.mjs', 'local/portable.d.mts',
  'local/portable-template.mjs', 'local/portable-template.d.mts', 'local/portable-runtime-hashes.mjs', 'local/portable-runtime-hashes.d.mts',
  'src/domain/input-contract.ts', 'src/domain/json.ts', 'src/shared/contracts.ts',
  'scripts/reproshare-workflow.mjs', 'scripts/reproshare-check.mjs', 'scripts/evaluate-workflow.mjs',
  'local/ci-provenance.mjs', 'local/ci-provenance.d.mts', 'scripts/reproshare-ci.mjs', 'docs/ci-provenance.md',
  'examples/ci/job.example.json', 'examples/ci/trust-policy.example.json', 'examples/ci/reproshare-public.yml',
  'docs/application-workflow.md', 'docs/pilot-protocol.md', 'docs/self-service-judge-test.md',
  'examples/workflow-templates/node/adapter.mjs', 'examples/workflow-templates/python/adapter.py',
  'examples/heldout/app.mjs', 'examples/heldout/adapter.mjs', 'examples/heldout/profile.json', 'examples/heldout/profile-fixed.json',
  'examples/heldout/profile-private-prerequisite.json', 'examples/heldout/freeze.json', 'examples/heldout/tasks.json', 'examples/heldout/engine-snapshot.json',
  'examples/heldout/engine-snapshot/workflow.mjs', 'examples/heldout/engine-snapshot/protocol.mjs',
  'examples/heldout/engine-snapshot/json.mjs', 'examples/heldout/engine-snapshot/input-contract.mjs',
  'examples/heldout/fixtures/T01.json', 'examples/heldout/fixtures/T02.json', 'examples/heldout/fixtures/T03.json',
  'examples/heldout/fixtures/T04.json', 'examples/heldout/fixtures/T05.json', 'examples/heldout/fixtures/T06.json',
  'examples/heldout/first-evaluation/environment-failure.json', 'examples/heldout/first-http-evaluation/evaluation.json',
  'examples/heldout/regression-with-optional-fix/evaluation.json', 'examples/heldout/PILOT.md',
  'examples/heldout/regression-source-independent-scalars/evaluation.json',
  'examples/heldout/upstream-generic-evaluation/README.md', 'examples/heldout/upstream-generic-evaluation/freeze.json',
  'examples/heldout/upstream-generic-evaluation/tasks.json', 'examples/heldout/upstream-generic-evaluation/first-results/evaluation.json',
  'examples/heldout/upstream-generic-evaluation/regression-source-independent-scalars/results/evaluation.json',
  'examples/heldout/upstream-generic-evaluation/evaluate.mjs',
  'examples/heldout/upstream-generic-evaluation/engine-snapshot/workflow.mjs',
  'examples/heldout/upstream-generic-evaluation/engine-snapshot/protocol.mjs',
  'examples/heldout/upstream-generic-evaluation/engine-snapshot/json.mjs',
  'examples/heldout/upstream-generic-evaluation/engine-snapshot/input-contract.mjs',
  'examples/heldout/upstream-generic-evaluation/profiles/hermes.json', 'examples/heldout/upstream-generic-evaluation/profiles/deburr.json',
  'examples/heldout/upstream-generic-evaluation/fixtures/U01.json', 'examples/heldout/upstream-generic-evaluation/fixtures/U02.json',
  'examples/heldout/upstream-generic-evaluation/fixtures/U03.json', 'examples/heldout/upstream-generic-evaluation/fixtures/U04.json',
  'examples/heldout/upstream-generic-evaluation/fixtures/U05.json', 'examples/heldout/upstream-generic-evaluation/fixtures/U06.json',
  'scripts/hermes-adapter.py', 'vendor/hermes/oracle-adapter.mjs', 'vendor/hermes/oracle.json', 'vendor/hermes/provenance.json',
  'vendor/hermes/before/LICENSE', 'vendor/hermes/before/model_tools.py', 'vendor/hermes/before/toolsets.py',
  'vendor/hermes/before/tools/__init__.py', 'vendor/hermes/before/tools/registry.py',
  'vendor/hermes/fixed/LICENSE', 'vendor/hermes/fixed/model_tools.py', 'vendor/hermes/fixed/toolsets.py',
  'vendor/hermes/fixed/tools/__init__.py', 'vendor/hermes/fixed/tools/registry.py',
  'vendor/second-case/adapter.mjs', 'vendor/second-case/provenance.json', 'vendor/second-case/oracle.json',
  'vendor/second-case/affected/deburr.ts', 'vendor/second-case/affected/LICENSE',
  'vendor/second-case/fixed/deburr.ts', 'vendor/second-case/fixed/LICENSE',
]);
Object.assign(files, {
  'installation-url.txt': 'artifacts/live/judge-install/installation-url.txt',
  'historical-upstream/hermes/repro.mjs': 'artifacts/verification-upgrade/hermes/repro.mjs',
  'historical-upstream/hermes/fixture.json': 'artifacts/verification-upgrade/hermes/fixture.json',
  'historical-upstream/hermes/original-public.json': 'artifacts/verification-upgrade/hermes/original-public.json',
  'historical-upstream/hermes/provenance.json': 'vendor/hermes/provenance.json',
  'historical-upstream/hermes/affected-MIT.txt': 'vendor/hermes/before/LICENSE',
  'historical-upstream/hermes/proposed-fix-MIT.txt': 'vendor/hermes/fixed/LICENSE',
  'historical-upstream/es-toolkit/repro.mjs': 'artifacts/verification-upgrade/es-toolkit/repro.mjs',
  'historical-upstream/es-toolkit/fixture.json': 'artifacts/verification-upgrade/es-toolkit/fixture.json',
  'historical-upstream/es-toolkit/original-public.json': 'artifacts/verification-upgrade/es-toolkit/original-public.json',
  'historical-upstream/es-toolkit/provenance.json': 'vendor/second-case/provenance.json',
  'historical-upstream/es-toolkit/affected-MIT.txt': 'vendor/second-case/affected/LICENSE',
  'historical-upstream/es-toolkit/fixed-MIT.txt': 'vendor/second-case/fixed/LICENSE',
});

function readme() {
  return `# ReproShare current application workflow judge kit

Start with [the self-service judge test](docs/self-service-judge-test.md).

This dependency-free kit contains current local CLI/runtime code and an authored HTTP invoice-import application with fictional data. Inspect code before authorising execution. Node.js 24.22+ is required. HTTP tests use ephemeral loopback sockets; no remote service or model key is needed. Commands below run from this extracted folder.

\`\`\`sh
node scripts/reproshare-workflow.mjs run --profile examples/heldout/profile.json --source examples/heldout/fixtures/T01.json --cwd "$PWD" --allow-command --out my-new-private-result
node scripts/reproshare-workflow.mjs export --profile examples/heldout/profile.json --source examples/heldout/fixtures/T01.json --result my-new-private-result/local-result.json --cwd "$PWD" --reviewed-code --out my-new-reviewed-package
\`\`\`

After inspecting all embedded source, copy only fixture.json and application-reproducer.mjs from the reviewed package to an empty recipient folder. Run \`node application-reproducer.mjs --allow-command fixture.json\`. This executes the actual selected application assertion, not the reference handler. A matching affected failure is the expected successful reproduction.

**Source-side transport:** workflow-review.json, local-result.json, local-oracle.json and private verification input files are not public recipient artifacts. The generated workflow-review.json is imported privately into ReproShare, which validates binding and produces a public projection. Do not attach it directly to a receiving issue.

The installation guide is https://reproshare-policies.musfk.chatgpt.site/install/; installation-url.txt contains the authorised public Atlassian link. For Jira evaluation create new dedicated resources only. Do not use or modify existing work projects. This archive does not claim a live installation/publication has occurred.

The six frozen authored tasks demonstrate three new payloads on one reusable profile and three negative controls. They are not independent human observations or three different bugs. First-seen engine/task evidence is preserved separately from later regressions. The optional [human pilot](docs/pilot-protocol.md) is **not performed**.

The separate [known-upstream generic-engine capability](examples/heldout/upstream-generic-evaluation/README.md) records **one of two positive tasks reproduced, one safely refused, and four negative controls correctly refused**. Hermes' ordinary control also preserves its failure in that frozen first record. The later source-independent-scalar **seen regression** again reproduces Hermes; its ordinary control now passes. Both records remain available. These already known entry points are not a blind study. The specialised historical es-toolkit runner remains a separate working path.

Optional [CI provenance tools](docs/ci-provenance.md) verify public-artifact integrity under a separately supplied signing-key/job/build policy. Local signing/verification is implemented. No provider-backed workflow or OIDC attestation has been run. A signature does not establish execution, and Forge evidence is not upgraded. The example policy contains placeholders; no private signing key is included.

[Historical upstream regressions](docs/self-service-judge-test.md) are under historical-upstream/. They execute pinned unchanged Hermes Python and es-toolkit TypeScript entry points. They are earlier evidence, not the current generic workflow or a fresh Jira publication. Python3.11+ is needed for Hermes. Dated source status, scopes and MIT notices are included.

manifest.json lists all archive hashes. Current source/runtime identity is recorded there. Code review remains necessary: checksums establish bytes, not trusted execution, privacy or root-cause equivalence. Replacing values retains reviewed keys, structure, constants and relationships.
`;
}

function assertNoCredentials(name, bytes) {
  if (name === 'installation-url.txt') return; // Explicitly authorised public installation capability.
  const text = bytes.toString('utf8');
  if (/\bBearer\s+[A-Za-z0-9._~+/=-]{24,}/.test(text)
    || /\bATATT3xFfGF0[A-Za-z0-9_-]{25,}/.test(text)
    || /\bsk-[A-Za-z0-9_-]{32,}/.test(text)
    || /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)
    || /["'](?:access_token|refresh_token|FORGE_API_TOKEN)["']\s*:\s*["'][A-Za-z0-9._~+/=-]{24,}["']/.test(text)) throw Error('possible-credential-in-curated-file:' + name);
  if (text.includes('/Users/yousufkhan/') && !name.startsWith('local/')) throw Error('owner-local-path-in-curated-file:' + name);
}

async function assertFrozenEvidence(directory) {
  for (const name of ['freeze.json', 'engine-snapshot.json']) {
    const manifest = JSON.parse(await readFile(join(directory, 'examples/heldout', name), 'utf8'));
    for (const file of manifest.files) if (sha256(await readFile(join(directory, 'examples/heldout', file.path))) !== file.sha256) throw Error('frozen-evidence-mismatch:' + file.path);
  }
  const upstreamBase = join(directory, 'examples/heldout/upstream-generic-evaluation');
  const upstream = JSON.parse(await readFile(join(upstreamBase, 'freeze.json'), 'utf8'));
  for (const file of upstream.files) if (sha256(await readFile(join(upstreamBase, file.path))) !== file.sha256) throw Error('upstream-frozen-evidence-mismatch:' + file.path);
}

async function build() {
  // Only the new current kit tree is replaced. Historical proof/archives stay untouched.
  await rm(kit, { recursive: true, force: true });
  await mkdir(kit, { recursive: true });
  const manifest = {};
  for (const [name, source] of Object.entries(files)) {
    const sourcePath = join(root, source);
    const stat = await lstat(sourcePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw Error('curated-file-not-regular:' + source);
    const bytes = await readFile(sourcePath);
    assertNoCredentials(name, bytes);
    await mkdir(dirname(join(kit, name)), { recursive: true });
    await copyFile(sourcePath, join(kit, name));
    manifest[name] = { bytes: bytes.length, sha256: sha256(bytes) };
  }
  const installer = new URL((await readFile(join(kit, 'installation-url.txt'), 'utf8')).trim());
  if (installer.origin !== 'https://developer.atlassian.com' || installer.pathname !== '/console/install/9084b288-4229-48c6-940f-556f165a3e20') throw Error('unexpected-public-installer');
  const notes = readme();
  await writeFile(join(kit, 'README.md'), notes);
  manifest['README.md'] = { bytes: Buffer.byteLength(notes), sha256: sha256(notes) };
  await assertFrozenEvidence(kit);
  const currentSeen = JSON.parse(await readFile(join(kit, 'examples/heldout/regression-source-independent-scalars/evaluation.json'), 'utf8'));
  if (currentSeen.engineHash !== manifest['local/workflow.mjs'].sha256 || currentSeen.mode !== 'seen-task-regression' || currentSeen.summary.expectedOutcomes !== 6) throw Error('current-seen-regression-does-not-match-engine');
  const envelope = { version: 1, builtAt: new Date().toISOString(), scope: 'current-local-workflow-and-fictional-authored-acceptance; historical-upstream-pairs-labelled',
    humanPilot: 'not-performed', runtime: process.version, currentEngineHash: manifest['local/workflow.mjs'].sha256, files: manifest };
  await writeFile(join(kit, 'manifest.json'), JSON.stringify(envelope, null, 2) + '\n');
  const names = [...Object.keys(manifest), 'manifest.json'];
  const zipped = spawnSync('python3', ['-c', 'import pathlib,sys,zipfile\nr=pathlib.Path(sys.argv[1])\nwith zipfile.ZipFile(sys.argv[2],"w",zipfile.ZIP_DEFLATED) as z:\n for n in sys.argv[3:]: z.write(r/n,"reproshare-workflow-judge-kit/"+n)', kit, archive, ...names], { encoding: 'utf8', env: childEnv });
  if (zipped.status !== 0) throw Error('zip-creation-failed');
  const bytes = await readFile(archive);
  const result = { version: 1, builtAt: envelope.builtAt, archive: 'artifacts/judge-workflow/kit.zip', archiveBytes: bytes.length,
    archiveSha256: sha256(bytes), fileCount: names.length, manifestEntries: Object.keys(manifest).length, currentEngineHash: envelope.currentEngineHash,
    frozenEvidence: 'hashes-checked', credentialScan: 'curated-file-heuristic-passed', humanPilot: 'not-performed' };
  await writeFile(join(artifacts, 'kit-build.json'), JSON.stringify(result, null, 2) + '\n');
  return result;
}

function runNode(args, cwd, expected = 0, timeout = 30_000) {
  const child = spawnSync(process.execPath, args, { cwd, env: childEnv, encoding: 'utf8', timeout, maxBuffer: 2 * 1024 * 1024 });
  if (child.status !== expected) {
    const error = Error('extracted-command-failed');
    error.detail = { command: args[0], exitCode: child.status, expected, code: /oracle-launch|original-failure-not-stable/.test(child.stderr) ? 'inspect-local-execution-environment' : 'command-did-not-match-expected' };
    throw error;
  }
  return child;
}

async function validate(buildInfo) {
  const temp = await mkdtemp(join(tmpdir(), 'reproshare-extracted-kit-'));
  const attempt = { startedAt: new Date().toISOString(), archiveSha256: buildInfo.archiveSha256, runtime: process.version, steps: [], status: 'running', scope: 'fresh-extraction-local-execution-no-Jira-or-customer-data' };
  try {
    const extracted = spawnSync('python3', ['-c', 'import sys,zipfile,pathlib\nr=pathlib.Path(sys.argv[2]).resolve()\nwith zipfile.ZipFile(sys.argv[1]) as z:\n for n in z.namelist():\n  p=(r/n).resolve()\n  if not p.is_relative_to(r): raise SystemExit("unsafe archive path")\n z.extractall(r)', archive, temp], { encoding: 'utf8', env: childEnv });
    if (extracted.status !== 0) throw Error('fresh-extraction-failed');
    const extractedRoot = join(temp, 'reproshare-workflow-judge-kit');
    const manifest = JSON.parse(await readFile(join(extractedRoot, 'manifest.json'), 'utf8'));
    for (const [name, entry] of Object.entries(manifest.files)) if (sha256(await readFile(join(extractedRoot, name))) !== entry.sha256) throw Error('extracted-manifest-mismatch');
    await assertFrozenEvidence(extractedRoot);
    attempt.steps.push({ name: 'archive-extraction-and-manifest', status: 'passed', files: Object.keys(manifest.files).length + 1 });
    runNode(['scripts/reproshare-workflow.mjs', '--help'], extractedRoot);
    const profile = JSON.parse(await readFile(join(extractedRoot, 'examples/heldout/profile.json'), 'utf8'));
    const scratch = join(temp, 'fresh-run'); await mkdir(scratch);
    await writeFile(join(scratch, 'contract.json'), JSON.stringify(profile.contract));
    await writeFile(join(scratch, 'oracle.json'), JSON.stringify(profile.oracle));
    const initialised = join(scratch, 'service-profile.json');
    runNode(['scripts/reproshare-workflow.mjs', 'init', '--id', profile.id, '--contract', join(scratch, 'contract.json'), '--oracle', join(scratch, 'oracle.json'), '--out', initialised], extractedRoot);
    attempt.steps.push({ name: 'clean-profile-init', status: 'passed' });
    for (const id of ['T01', 'T02', 'T03']) {
      const source = join(extractedRoot, 'examples/heldout/fixtures', id + '.json');
      const resultDir = join(scratch, id + '-private');
      runNode(['scripts/reproshare-workflow.mjs', 'run', '--profile', initialised, '--source', source, '--cwd', extractedRoot, '--allow-command', '--out', resultDir], extractedRoot);
      const result = JSON.parse(await readFile(join(resultDir, 'local-result.json'), 'utf8'));
      if (result.report.verdict !== 'verified' || result.report.evidenceLevel !== 'failure-reproduced') throw Error('pre-fix-result-not-verified');
      attempt.steps.push({ name: 'current-cli-' + id, status: 'passed', evidenceLevel: result.report.evidenceLevel, fixtureHash: result.report.fixtureHash,
        searchRuns: result.searchSummary.runs, removedParts: result.searchSummary.removedParts });
      if (id === 'T01') {
        const reviewed = join(scratch, 'reviewed');
        runNode(['scripts/reproshare-workflow.mjs', 'export', '--profile', initialised, '--source', source, '--result', join(resultDir, 'local-result.json'), '--cwd', extractedRoot, '--reviewed-code', '--out', reviewed], extractedRoot);
        const transport = JSON.parse(await readFile(join(reviewed, 'workflow-review.json'), 'utf8'));
        if (transport.kind !== 'reproshare-workflow-review' || transport.report.sourceHash !== sha256(await readFile(source))) throw Error('private-transport-binding-mismatch');
        const recipient = join(temp, 'recipient-only'); await mkdir(recipient);
        for (const name of ['fixture.json', 'application-reproducer.mjs']) await copyFile(join(reviewed, name), join(recipient, name));
        const publicBytes = await readFile(join(recipient, 'application-reproducer.mjs'), 'utf8');
        for (const privateDigest of [result.report.sourceHash, result.report.configurationHash, result.report.oracleHash, result.report.evidenceHash]) if (publicBytes.includes(privateDigest)) throw Error('private-report-binding-in-recipient-runner');
        const child = runNode(['application-reproducer.mjs', '--allow-command', 'fixture.json'], recipient);
        const received = JSON.parse(child.stdout);
        if (received.results?.affected?.outcome !== 'fail' || !received.results.affected.matchedExpected) throw Error('recipient-actual-assertion-not-reproduced');
        attempt.steps.push({ name: 'reviewed-export-and-isolated-actual-recipient', status: 'passed', privateTransport: 'source-authorised-import-only',
          recipientFiles: ['fixture.json', 'application-reproducer.mjs'], originalAvailable: false, privateReportBindingsAbsent: true,
          assertionId: received.assertionId, runnerHash: sha256(publicBytes) });
        const unconsented = runNode(['application-reproducer.mjs', 'fixture.json'], recipient, 1);
        if (!unconsented.stderr.includes('explicit-command-consent-required')) throw Error('recipient-consent-check-failed');
        await writeFile(join(recipient, 'fixture.json'), '{}');
        const tampered = runNode(['application-reproducer.mjs', '--allow-command', 'fixture.json'], recipient, 1);
        if (!tampered.stderr.includes('fixture-hash-mismatch')) throw Error('recipient-tamper-check-failed');
        attempt.steps.push({ name: 'recipient-consent-and-tamper-negatives', status: 'passed' });
        const ci = join(scratch, 'public-ci-integrity'); await mkdir(ci);
        const { sourceHash, configurationHash, oracleHash, evidenceHash, ...publicFields } = result.report;
        const unsigned = { ...publicFields, kind: 'reproshare-public-verification', sourceKind: 'private-original-checked-locally', bindingId: randomUUID() };
        const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
          : value !== null && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);
        const publicReceipt = { ...unsigned, evidenceHash: sha256(canonical(unsigned)) };
        const receiptPath = join(ci, 'public-verification.json'); const specPath = join(ci, 'verification-spec.json');
        const jobPath = join(ci, 'declared-local-job.json'); const statementPath = join(ci, 'statement.json');
        await writeFile(receiptPath, JSON.stringify(publicReceipt)); await writeFile(specPath, JSON.stringify(result.verificationSpec));
        const job = { provider: 'declared-local', repository: 'example/local-integrity-check', commit: '0'.repeat(40), workflow: '.github/workflows/local-example.yml', runId: '1', runAttempt: 1, jobId: 'declared-local-check' };
        await writeFile(jobPath, JSON.stringify(job));
        const publicInputs = ['--public-receipt', receiptPath, '--fixture', join(reviewed, 'fixture.json'), '--runner', join(reviewed, 'application-reproducer.mjs'), '--test-spec', specPath];
        runNode(['scripts/reproshare-ci.mjs', 'manifest', ...publicInputs, '--job', jobPath, '--out', statementPath], extractedRoot);
        const key = generateKeyPairSync('ed25519'); const keyPath = join(ci, 'ephemeral-private-key.pem');
        await writeFile(keyPath, key.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
        const signedPath = join(ci, 'signed.json');
        runNode(['scripts/reproshare-ci.mjs', 'sign', '--manifest', statementPath, '--key-id', 'temporary-local-test-key', '--private-key', keyPath, '--out', signedPath], extractedRoot);
        const { declaredBuildForSpec } = await import(pathToFileURL(join(extractedRoot, 'local/ci-provenance.mjs')).href);
        const trustPath = join(ci, 'separate-trust-policy.json');
        await writeFile(trustPath, JSON.stringify({ version: 1, kind: 'reproshare-ci-trust-policy', keyId: 'temporary-local-test-key', publicKeyPem: key.publicKey.export({ type: 'spki', format: 'pem' }), expectedJob: job, expectedBuild: declaredBuildForSpec(result.verificationSpec) }));
        const verifiedPath = join(ci, 'verified.json');
        runNode(['scripts/reproshare-ci.mjs', 'verify', '--signed', signedPath, '--trust', trustPath, ...publicInputs, '--out', verifiedPath], extractedRoot);
        const verified = JSON.parse(await readFile(verifiedPath, 'utf8'));
        if (verified.execution !== 'not-attested' || verified.providerIdentity !== 'not-verified-by-this-tool') throw Error('ci-misrepresented-execution');
        attempt.steps.push({ name: 'offline-public-artifact-ci-signature', status: 'passed', receiptScope: 'locally-constructed-public-projection-for-component-test', execution: verified.execution, providerIdentity: verified.providerIdentity, realProviderRun: false });
      }
    }
    for (const [id, profileName, expected] of [['T04', 'profile.json', 'original-failure-not-stable'], ['T05', 'profile.json', 'original-input-invalid'], ['T06', 'profile-private-prerequisite.json', 'no-safe-failing-variant']]) {
      const child = runNode(['scripts/reproshare-workflow.mjs', 'run', '--profile', join(extractedRoot, 'examples/heldout', profileName), '--source', join(extractedRoot, 'examples/heldout/fixtures', id + '.json'), '--cwd', extractedRoot, '--allow-command', '--out', join(scratch, id + '-refusal')], extractedRoot, 1);
      if (!child.stderr.includes(expected) && !(id === 'T06' && child.stderr.includes('search-budget-exhausted'))) throw Error('negative-task-wrong-result');
      attempt.steps.push({ name: 'current-negative-' + id, status: 'passed', expected });
    }
    for (const name of ['hermes', 'es-toolkit']) {
      const child = runNode(['historical-upstream/' + name + '/repro.mjs', 'historical-upstream/' + name + '/fixture.json'], extractedRoot);
      const report = JSON.parse(child.stdout);
      if (report.sameFailureRetained !== true || !(report.proposedFixPasses === true || report.fixedPasses === true)) throw Error('historical-upstream-check-failed');
      attempt.steps.push({ name: 'historical-upstream-' + name, status: 'passed', historical: true, fixtureHash: report.fixtureHash });
    }
    const capabilityOut = join(scratch, 'known-upstream-replay');
    runNode(['examples/heldout/upstream-generic-evaluation/evaluate.mjs', '--out', capabilityOut], extractedRoot);
    const capability = JSON.parse(await readFile(join(capabilityOut, 'evaluation.json'), 'utf8'));
    if (capability.summary.positiveAttempted !== 2 || capability.summary.positiveReproduced !== 1 || capability.summary.negativeCorrectRefusals !== 4
      || capability.summary.falseVerifiedNegatives !== 0 || capability.summary.unexpectedErrors !== 0) throw Error('known-upstream-capability-replay-changed');
    attempt.steps.push({ name: 'frozen-known-upstream-generic-replay', status: 'passed', expected: 'one-positive-reproduced-one-positive-refused-four-negative-refusals', summary: capability.summary });
    attempt.status = 'passed';
  } catch (error) {
    attempt.status = 'failed';
    attempt.errorCode = /^[a-z][a-z0-9-]+$/.test(error.message) ? error.message : 'kit-validation-failed';
    if (error.detail) attempt.detail = error.detail;
    process.exitCode = 2;
  } finally {
    attempt.completedAt = new Date().toISOString();
    await rm(temp, { recursive: true, force: true });
    const path = join(artifacts, 'kit-validation.json');
    let previous;
    try { previous = JSON.parse(await readFile(path, 'utf8')); } catch { previous = null; }
    const history = previous?.attempts ?? [];
    await writeFile(path, JSON.stringify({ version: 1, latestStatus: attempt.status, attempts: [...history, attempt] }, null, 2) + '\n');
  }
  return attempt;
}

const args = process.argv.slice(2);
if (args.some(arg => arg !== '--validate')) throw Error('unsupported-package-option');
const result = await build();
if (args.includes('--validate')) result.validation = await validate(result);
// Prepared local download assets only; the caller publishes through the Sites workflow.
const downloads = join(artifacts, 'kit-public-assets');
await mkdir(downloads, { recursive: true });
await copyFile(archive, join(downloads, 'reproshare-workflow-judge-kit.zip'));
await writeFile(join(downloads, 'reproshare-workflow-judge-kit.sha256'), result.archiveSha256 + '  reproshare-workflow-judge-kit.zip\n');
await copyFile(join(root, 'docs/self-service-judge-test.md'), join(downloads, 'self-service-judge-test.md'));
await copyFile(join(root, 'docs/ci-provenance.md'), join(downloads, 'ci-provenance.md'));
await writeFile(join(downloads, 'download-metadata.json'), JSON.stringify({ version: 1, preparedAt: new Date().toISOString(),
  filename: 'reproshare-workflow-judge-kit.zip', bytes: result.archiveBytes, sha256: result.archiveSha256,
  scope: 'current-local-workflow; fictional-authored-HTTP-example; labelled-historical-upstream-pairs',
  latestValidation: result.validation?.status ?? 'not-run-for-this-build', ciScope: 'local-signature-integrity-only-provider-OIDC-unrun', humanPilot: 'not-performed' }, null, 2) + '\n');
if (result.validation) await copyFile(join(artifacts, 'kit-validation.json'), join(downloads, 'kit-validation.json'));
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
