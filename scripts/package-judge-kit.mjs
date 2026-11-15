// Curated local review archive. No uploads, registration or distribution changes.
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const kit = resolve(root, 'artifacts/submission/judge-kit');
const files = {
  'README.md': 'artifacts/submission/judge-kit-readme.md',
  'fixture.json': 'artifacts/live/production-hermes/fixture.json',
  'repro.mjs': 'artifacts/live/production-hermes/repro.mjs',
  'results.json': 'artifacts/live/production-hermes/results.json',
  'recipient-results.json': 'artifacts/live/production-hermes/recipient/results.json',
  'original-public.json': 'artifacts/upstream/hermes/original-public.json',
  'target-checks.json': 'artifacts/live/production-hermes/target-checks.json',
  'retrieval-checks.json': 'artifacts/live/production-hermes/retrieval-checks.json',
  'provenance.json': 'vendor/hermes/provenance.json',
  'licenses/hermes-affected-MIT.txt': 'vendor/hermes/before/LICENSE',
  'licenses/hermes-proposed-fix-MIT.txt': 'vendor/hermes/fixed/LICENSE',
  'reproshare-demo.mp4': 'artifacts/submission/reproshare-demo.mp4',
  'reproshare-demo.srt': 'artifacts/submission/reproshare-demo.srt',
  'reproshare-demo-transcript.md': 'artifacts/submission/reproshare-demo-transcript.md',
  'jira-production-crop.png': 'artifacts/submission/production-proof/jira-production-crop.png',
  'installation-url.txt': 'artifacts/live/judge-install/installation-url.txt',
  'installation-test/verification.json': 'artifacts/live/judge-install/verification.json',
  'installation-test/fixture.json': 'artifacts/live/judge-install/fixture.json',
  'installation-test/repro.mjs': 'artifacts/live/judge-install/repro.mjs',
  'installation-test/results.json': 'artifacts/live/judge-install/results.json',
  'ui-preview/README.md': 'artifacts/design/judge-ui-notes.md',
  'ui-preview/source.png': 'artifacts/design/minimal/desktop-source-empty.png',
  'ui-preview/review.png': 'artifacts/design/minimal/desktop-review.png',
  'reproshare-demo-poster.png': 'artifacts/submission/reproshare-demo-poster.png',
  'gallery/README.md': 'artifacts/submission/gallery/README.md',
  'gallery/manifest.json': 'artifacts/submission/gallery/manifest.json',
  'gallery/01-public-regression.png': 'artifacts/submission/gallery/01-public-regression.png',
  'gallery/02-reference-checks.png': 'artifacts/submission/gallery/02-reference-checks.png',
  'gallery/03-reviewed-artifacts.png': 'artifacts/submission/gallery/03-reviewed-artifacts.png',
  'gallery/04-sharing-confirmation.png': 'artifacts/submission/gallery/04-sharing-confirmation.png',
  'gallery/05-actual-offline-proof.png': 'artifacts/submission/gallery/05-actual-offline-proof.png',
  'gallery/06-local-verification.png': 'artifacts/submission/gallery/06-local-verification.png',
  'verification-upgrade/hosted-smoke.json': 'artifacts/verification-upgrade/hosted-smoke.json',
  'movie-proof/README.md': 'artifacts/submission/movie-proof-readme.md',
  'movie-proof/provenance.json': 'artifacts/submission/movie-proof-provenance.json',
  'movie-proof/fixture.json': 'artifacts/submission/design-proof/fixture.json',
  'movie-proof/repro.mjs': 'artifacts/submission/design-proof/repro.mjs',
  'movie-proof/results.json': 'artifacts/submission/design-proof/results.json',
  'media/build-metadata.json': 'artifacts/submission/mcp-edit/build-metadata.json',
  'media/video-qa.json': 'artifacts/submission/mcp-edit/video-qa.json',
  'media/audio-qa.json': 'artifacts/submission/mcp-edit/audio-qa.json',
  'media/demo-edit.json': 'artifacts/submission/demo-edit.json',
  'artifacts/live/external-mcp/sdk-session-1.json': 'artifacts/live/external-mcp/sdk-session-1.json',
  'artifacts/live/external-mcp/public-discovery.json': 'artifacts/live/external-mcp/public-discovery.json',
  'artifacts/live/external-mcp/exposure.json': 'artifacts/live/external-mcp/exposure.json',
  'docs/external-mcp-verification.md': 'docs/external-mcp-verification.md',
  'scripts/mcp-verify.mjs': 'scripts/mcp-verify.mjs',
};

// Preserve repository-relative paths: oracle argv and declared source manifests
// then work unchanged from the extracted archive root. Never replace with globs.
const verificationUpgradeFiles = [
  'local/protocol.mjs',
  'local/protocol.d.mts',
  'local/json.mjs',
  'local/input-contract.mjs',
  'scripts/reproshare-check.mjs',
  'scripts/hermes-adapter.py',
  'vendor/hermes/oracle-adapter.mjs',
  'vendor/hermes/oracle.json',
  'vendor/hermes/provenance.json',
  'vendor/hermes/before/LICENSE',
  'vendor/hermes/before/model_tools.py',
  'vendor/hermes/before/toolsets.py',
  'vendor/hermes/before/tools/__init__.py',
  'vendor/hermes/before/tools/registry.py',
  'vendor/hermes/fixed/LICENSE',
  'vendor/hermes/fixed/model_tools.py',
  'vendor/hermes/fixed/toolsets.py',
  'vendor/hermes/fixed/tools/__init__.py',
  'vendor/hermes/fixed/tools/registry.py',
  'vendor/second-case/adapter.mjs',
  'vendor/second-case/oracle.json',
  'vendor/second-case/provenance.json',
  'vendor/second-case/affected/deburr.ts',
  'vendor/second-case/affected/LICENSE',
  'vendor/second-case/fixed/deburr.ts',
  'vendor/second-case/fixed/LICENSE',
  'artifacts/verification-upgrade/hermes/verification-inputs.json',
  'artifacts/verification-upgrade/hermes/original-public.json',
  'artifacts/verification-upgrade/hermes/fixture.json',
  'artifacts/verification-upgrade/hermes/repro.mjs',
  'artifacts/verification-upgrade/hermes/local-report.json',
  'artifacts/verification-upgrade/hermes/report.md',
  'artifacts/verification-upgrade/es-toolkit/verification-inputs.json',
  'artifacts/verification-upgrade/es-toolkit/original-public.json',
  'artifacts/verification-upgrade/es-toolkit/fixture.json',
  'artifacts/verification-upgrade/es-toolkit/ordinary.json',
  'artifacts/verification-upgrade/es-toolkit/repro.mjs',
  'artifacts/verification-upgrade/es-toolkit/local-report.json',
  'artifacts/verification-upgrade/es-toolkit/report.md',
  'artifacts/verification-upgrade/browser/local-evidence.png',
  'artifacts/upstream/second-case/verification-inputs.json',
  'artifacts/upstream/second-case/original-public.json',
  'artifacts/upstream/second-case/fixture.json',
  'artifacts/upstream/second-case/ordinary.json',
  'artifacts/upstream/second-case/repro.mjs',
  'artifacts/upstream/second-case/report.md',
  'artifacts/upstream/second-case/preparation.json',
  'artifacts/upstream/second-case/results.json',
  'artifacts/upstream/second-case/source-reference.json',
  'artifacts/upstream/second-case/verification-evidence.json',
  'artifacts/upstream/second-case/verification-evidence-film-2026-11-15.json',
  'docs/local-verification.md',
  'docs/second-application-case.md',
];
for (const path of verificationUpgradeFiles) files[path] = path;

const fixture = readFileSync(resolve(root, files['fixture.json']));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const result = JSON.parse(readFileSync(resolve(root, files['results.json']), 'utf8'));
if (digest(fixture) !== result.fixtureHash || !result.sameFailureRetained || !result.proposedFixPasses) {
  throw new Error('Judge fixture/result mismatch');
}
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : value !== null && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
    : JSON.stringify(value);
const currentRunnerHash = digest(canonical(['protocol.mjs', 'json.mjs', 'input-contract.mjs', '../scripts/reproshare-check.mjs']
  .map(path => ({ path, sha256: digest(readFileSync(resolve(root, 'local', path))) }))));
const verifiedCases = {};
for (const [name, directory, reportName, oraclePath] of [
  ['hermes', 'artifacts/verification-upgrade/hermes', 'local-report.json', 'vendor/hermes/oracle.json'],
  ['es-toolkit-upgrade', 'artifacts/verification-upgrade/es-toolkit', 'local-report.json', 'vendor/second-case/oracle.json'],
  ['es-toolkit-deburr', 'artifacts/upstream/second-case', 'verification-evidence.json', 'vendor/second-case/oracle.json'],
]) {
  const inputs = JSON.parse(readFileSync(resolve(root, directory, 'verification-inputs.json'), 'utf8'));
  const report = JSON.parse(readFileSync(resolve(root, directory, reportName), 'utf8'));
  const { evidenceHash, ...unsigned } = report;
  const expected = { original: 'fail', ordinary: 'pass', synthetic: 'fail', fixedOriginal: 'pass', fixedOrdinary: 'pass', fixedSynthetic: 'pass' };
  if (inputs.kind !== 'reproshare-verification-inputs' || report.kind !== 'reproshare-local-verification'
    || report.verdict !== 'verified' || report.failures.length || digest(canonical(unsigned)) !== evidenceHash
    || report.runner.sha256 !== currentRunnerHash
    || !Object.keys(expected).every(cell => report.matrix[cell]?.outcome === expected[cell] && report.matrix[cell]?.matchedExpected === true)
    || !['original', 'ordinary', 'synthetic'].every(input => report.inputValidity[input] === true)
    || !['sourceHash', 'ordinaryHash', 'fixtureHash', 'configurationHash'].every(hash => report[hash] === inputs[hash])
    || report.contractHash !== inputs.inputContractHash
    || digest(readFileSync(resolve(root, directory, 'fixture.json'))) !== inputs.fixtureHash
    || digest(readFileSync(resolve(root, directory, 'original-public.json'))) !== inputs.sourceHash
    || digest(inputs.fixtureJson) !== inputs.fixtureHash || digest(inputs.ordinaryJson) !== inputs.ordinaryHash
    || digest(canonical(JSON.parse(readFileSync(resolve(root, oraclePath), 'utf8')))) !== report.oracleHash
    || !['original', 'synthetic'].every(cell => report.matrix[cell].assertionId === report.assertionId && report.matrix[cell].failureKind === report.failureKind)) {
    throw new Error('Verification upgrade case is stale or incomplete: ' + name);
  }
  for (const adapter of Object.values(report.adapters)) {
    for (const file of adapter.files) {
      if (files[file.path] !== file.path || digest(readFileSync(resolve(root, file.path))) !== file.sha256) {
        throw new Error('Declared oracle dependency missing or changed: ' + file.path);
      }
    }
  }
  verifiedCases[name] = { fixtureHash: report.fixtureHash, evidenceHash, assertionId: report.assertionId,
    affectedRevision: report.adapters.affected.revision, fixedRevision: report.adapters.fixed.revision };
}
const manifest = {};
for (const [name, source] of Object.entries(files)) {
  const destination = resolve(kit, name);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(resolve(root, source), destination);
  const bytes = readFileSync(destination);
  manifest[name] = { bytes: bytes.length, sha256: digest(bytes) };
}
writeFileSync(resolve(kit, 'manifest.json'), JSON.stringify({
  generatedOn: '2026-11-15',
  purpose: 'Local reviewable judge kit; no public distribution or submission',
  fixtureHash: result.fixtureHash,
  verificationCases: verifiedCases,
  files: manifest,
}, null, 2) + '\n');

// Explicit allowlist: never archive the surrounding artifacts directory or raw PDF.
const archive = resolve(root, 'artifacts/submission/reproshare-judge-kit.zip');
const zipped = spawnSync('python3', ['-c', [
  'import pathlib,sys,zipfile',
  'root=pathlib.Path(sys.argv[1]); names=sys.argv[3:]',
  'with zipfile.ZipFile(sys.argv[2], "w", zipfile.ZIP_DEFLATED) as z:',
  ' for name in names:',
  '  p=root/name',
  '  if p.is_symlink() or not p.is_file(): raise SystemExit("Expected regular curated file")',
  '  z.write(p, "reproshare-judge-kit/"+name)',
].join('\n'), kit, archive, ...Object.keys(files), 'manifest.json'], { encoding: 'utf8' });
if (zipped.status !== 0) throw new Error(zipped.stderr || 'ZIP creation failed');
console.log(JSON.stringify({ archive, files: Object.keys(files).length + 1,
  fixtureHash: result.fixtureHash, archiveSha256: digest(readFileSync(archive)) }, null, 2));
