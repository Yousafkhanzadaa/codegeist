#!/usr/bin/env node
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseServiceProfile, synthesizeWorkflow, verificationSpecForProfile } from '../local/workflow.mjs';
import { importSchema } from '../local/schema-import.mjs';
import { buildPortableRunner } from '../local/portable.mjs';
import { runVerification, sha256, evidenceHash } from '../local/protocol.mjs';
import { parseInputContract, inputContractHash } from '../local/input-contract.mjs';
import { parseBoundedJson, JSON_LIMITS, canonicalJson } from '../local/json.mjs';

const help = `ReproShare application workflow (local execution; no Jira writes)

Connect once:
  node scripts/reproshare-workflow.mjs init --id my-service \\
    --schema schema.json --oracle oracle.json --out service-profile.json
  Use --contract contract.json instead of --schema for a ReproShare contract.
  OpenAPI: --schema openapi.json --pointer /components/schemas/MyInput
  Enums/constants require --public-constants after reviewing every literal.

Generate, test and minimise each new private input:
  node scripts/reproshare-workflow.mjs run --profile service-profile.json \\
    --source private-original.json --cwd /absolute/owned-application \\
    --allow-command --out new-private-result-directory

After reviewing ALL pinned application/test source for private literals/secrets:
  node scripts/reproshare-workflow.mjs export --profile service-profile.json \\
    --source private-original.json --result new-private-result-directory/local-result.json \\
    --cwd /absolute/owned-application --reviewed-code --out new-reviewed-directory

Upload ONLY workflow-review.json through Jira's “Import application workflow”.
The source-authorised import removes private report bindings before publication.
Keep local-result.json, private source and service profile out of receiving issues.

Recipient: node application-reproducer.mjs --allow-command fixture.json

Commands execute reviewed code with your OS permissions; this is not a sandbox.
Search is bounded and can refuse. A matching failure is not root-cause proof or
anonymity. No cloud/model/network request is made by this command itself.
`;

const flags = new Set(['--allow-command', '--reviewed-code', '--public-constants']);
const values = new Set(['--id', '--schema', '--contract', '--pointer', '--oracle', '--out', '--profile', '--source', '--cwd', '--result']);
function options(args) {
  const result = {};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (!flags.has(flag) && !values.has(flag) || result[flag] !== undefined) throw Error('invalid-command-options');
    if (flags.has(flag)) result[flag] = true;
    else {
      if (!args[index + 1] || args[index + 1].startsWith('--')) throw Error('invalid-command-options');
      result[flag] = args[++index];
    }
  }
  return result;
}
async function json(path, cap = 65_536) {
  const bytes = await readFile(resolve(path));
  return parseBoundedJson(bytes, { ...JSON_LIMITS, bytes: cap, string: cap });
}
async function save(path, value) { await writeFile(path, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
async function freshDirectory(path, work) {
  if (!path) throw Error('output-directory-required');
  const target = resolve(path);
  await mkdir(target, { mode: 0o700 });
  try { return await work(target); }
  catch (error) { await rm(target, { recursive: true, force: true }); throw error; }
}
function required(o, names) { if (names.some(name => typeof o[name] !== 'string' || !o[name])) throw Error('required-option-missing'); }

export async function main(args = process.argv.slice(2)) {
  if (!args.length || args[0] === '--help') { process.stdout.write(help); return; }
  const [command, ...rest] = args;
  const o = options(rest);
  if (command === 'init') {
    required(o, ['--id', '--oracle', '--out']);
    if (Boolean(o['--schema']) === Boolean(o['--contract'])) throw Error('choose-schema-or-contract');
    const contract = o['--contract'] ? parseInputContract(await json(o['--contract'])) : importSchema(await json(o['--schema'], 262_144), { pointer: o['--pointer'] ?? '', publicEnums: o['--public-constants'] === true });
    const profile = parseServiceProfile({ version: 1, id: o['--id'], contract, oracle: await json(o['--oracle']) });
    await save(resolve(o['--out']), profile);
    process.stdout.write('Reusable local service profile saved. Review its code, public constants and commands before use.\n');
  } else if (command === 'run') {
    required(o, ['--profile', '--source', '--cwd', '--out']);
    if (o['--allow-command'] !== true) throw Error('command-consent-required');
    const profile = parseServiceProfile(await json(o['--profile']));
    const sourceJson = await readFile(resolve(o['--source']), 'utf8');
    if (Buffer.byteLength(sourceJson) > 65_536) throw Error('source-size-limit');
    await freshDirectory(o['--out'], async directory => {
      const result = await synthesizeWorkflow({ sourceJson, profile, cwd: resolve(o['--cwd']), allowCommand: true });
      const sourcePath = resolve(o['--source']);
      const ordinaryPath = join(directory, 'ordinary-private-control.json');
      const fixturePath = join(directory, 'fixture.json');
      const contractPath = join(directory, 'contract.json');
      const oraclePath = join(directory, 'local-oracle.json');
      await save(ordinaryPath, result.ordinaryJson);
      await save(fixturePath, result.fixtureJson);
      await save(contractPath, profile.contract);
      await save(oraclePath, profile.oracle);
      const packagePath = join(directory, 'verification-inputs-private.json');
      await save(packagePath, { version: 1, kind: 'reproshare-verification-inputs', configurationHash: result.configurationHash,
        sourceHash: sha256(sourceJson), ordinaryHash: sha256(result.ordinaryJson), fixtureHash: sha256(result.fixtureJson), inputContractHash: result.inputContractHash,
        ordinaryJson: result.ordinaryJson, fixtureJson: result.fixtureJson, inputContract: profile.contract, verificationSpec: result.verificationSpec, testSpecHash: result.testSpecHash });
      const report = await runVerification({ packagePath, oraclePath, sourcePath, cwd: resolve(o['--cwd']), allowCommand: true });
      if (report.verdict !== 'verified') throw Error('final-application-check-rejected');
      const localResult = { version: 1, kind: 'reproshare-local-workflow-result', profileId: profile.id, title: profile.title,
        fixtureJson: result.fixtureJson, ordinaryJson: result.ordinaryJson, inputContract: profile.contract, verificationSpec: result.verificationSpec,
        report, searchSummary: result.searchSummary };
      await save(join(directory, 'local-result.json'), localResult);
      await save(join(directory, 'search-summary.json'), result.searchSummary);
      process.stdout.write('Failure reproduced using changed values. Private results saved; review code before export.\n');
    });
  } else if (command === 'export') {
    required(o, ['--profile', '--source', '--result', '--cwd', '--out']);
    if (o['--reviewed-code'] !== true) throw Error('portable-code-review-required');
    const profile = parseServiceProfile(await json(o['--profile']));
    const result = await json(o['--result'], 262_144);
    if (result.version !== 1 || result.kind !== 'reproshare-local-workflow-result' || result.profileId !== profile.id || result.report?.verdict !== 'verified') throw Error('invalid-local-workflow-result');
    if (result.report.kind !== 'reproshare-local-verification' || result.report.evidenceHash !== evidenceHash(result.report)
      || result.report.contractHash !== inputContractHash(profile.contract) || result.report.ordinaryHash !== sha256(result.ordinaryJson)
      || canonicalJson(result.inputContract) !== canonicalJson(profile.contract)
      || canonicalJson(result.verificationSpec) !== canonicalJson(verificationSpecForProfile(profile))) throw Error('workflow-result-binding-mismatch');
    const sourceJson = await readFile(resolve(o['--source']), 'utf8');
    if (sha256(sourceJson) !== result.report.sourceHash || sha256(result.fixtureJson) !== result.report.fixtureHash) throw Error('workflow-source-or-fixture-mismatch');
    const portable = await buildPortableRunner({ profile, cwd: resolve(o['--cwd']), fixtureJson: result.fixtureJson, reviewedCode: true, privateSourceJson: sourceJson });
    if (result.report.testSpecHash !== portable.testSpecHash) throw Error('workflow-test-spec-mismatch');
    const review = { version: 1, kind: 'reproshare-workflow-review', profileId: profile.id, title: profile.title, fixtureJson: result.fixtureJson,
      ordinaryJson: result.ordinaryJson, inputContract: result.inputContract, verificationSpec: result.verificationSpec, report: result.report,
      portableRunner: portable.runner, disclosures: [...result.searchSummary.disclosures, ...portable.disclosures], searchSummary: result.searchSummary };
    if (Buffer.byteLength(JSON.stringify(review)) > 220 * 1024) throw Error('workflow-review-size-limit');
    await freshDirectory(o['--out'], async directory => {
      await save(join(directory, 'fixture.json'), result.fixtureJson);
      await save(join(directory, 'application-reproducer.mjs'), portable.runner);
      await save(join(directory, 'workflow-review.json'), review);
      await save(join(directory, 'README.txt'), 'Source-authorised review import: workflow-review.json contains private local report bindings. Import it into ReproShare; never attach this JSON directly to the receiving issue.\n\nRecipient files: fixture.json and application-reproducer.mjs. Inspect embedded code and use: node application-reproducer.mjs --allow-command fixture.json\n\n' + review.disclosures.join('\n') + '\n');
    });
    process.stdout.write('Reviewed application package saved. Import workflow-review.json privately into ReproShare.\n');
  } else throw Error('unknown-command');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  const code = typeof error?.code === 'string' && /^[a-z][a-z0-9-]{0,79}$/.test(error.code) ? error.code
    : typeof error?.message === 'string' && /^[a-z][a-z0-9-]{0,79}$/.test(error.message) ? error.message : 'workflow-unavailable';
  process.stderr.write('ReproShare workflow failed [' + code + ']. No successful package published.\n');
  process.exitCode = 1;
});
