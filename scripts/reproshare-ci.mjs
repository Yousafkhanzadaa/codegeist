#!/usr/bin/env node
import { lstat, open, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { createCiStatement, parseCiJob, parseCiJson, parseCiTrustPolicy, signCiStatement, verifyCiStatement } from '../local/ci-provenance.mjs';

const help = `ReproShare PUBLIC-artifact signature support (no Jira writes)

Create a public artifact statement:
  node scripts/reproshare-ci.mjs manifest --public-receipt public-verification.json \\
    --fixture fixture.json --runner application-reproducer.mjs \\
    --test-spec verification-spec.json --job expected-job.json --out manifest.json

Sign with an explicitly chosen local Ed25519 private key:
  node scripts/reproshare-ci.mjs sign --manifest manifest.json \\
    --key-id separately-trusted-key-id --private-key /private/ci-key.pem --out signed.json

Verify against separately trusted key/job/build policy and actual public files:
  node scripts/reproshare-ci.mjs verify --signed signed.json --trust trusted-policy.json \\
    --public-receipt public-verification.json --fixture fixture.json \\
    --runner application-reproducer.mjs --test-spec verification-spec.json --out verified.json

No key from signed.json is trusted. Private local reports/workflow-review.json
are rejected. A signature does not attest execution or GitHub identity. Verify
GitHub provenance separately with gh attestation verify and external identity
policy. This tool never upgrades Forge evidence or contacts a CI provider.
`;
const names = new Set(['--public-receipt', '--fixture', '--runner', '--test-spec', '--job', '--out', '--manifest', '--key-id', '--private-key', '--signed', '--trust']);
async function bytes(path, maximum) {
  const target = resolve(path);
  const stat = await lstat(target);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum) throw Error('ci-file-rejected');
  const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size > maximum) throw Error('ci-file-rejected');
    const result = Buffer.alloc(maximum + 1); let length = 0;
    while (length <= maximum) {
      const { bytesRead } = await handle.read(result, length, result.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
      if (length > maximum) throw Error('ci-file-rejected');
    }
    return result.subarray(0, length);
  } finally { await handle.close(); }
}
async function json(path, maximum = 32 * 1024) { return parseCiJson(await bytes(path, maximum), maximum); }
function required(o, fields) { if (fields.some(field => !o[field])) throw Error('ci-required-option-missing'); }
async function statement(o, job) {
  required(o, ['--public-receipt', '--fixture', '--runner', '--test-spec']);
  return createCiStatement({ publicReceipt: await json(o['--public-receipt']), fixtureBytes: await bytes(o['--fixture'], 65536),
    runnerBytes: await bytes(o['--runner'], 180 * 1024), testSpec: await json(o['--test-spec']), job });
}
async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args[0] === '--help') { process.stdout.write(help); return; }
  const command = args.shift(); const o = {};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (!names.has(flag) || o[flag] !== undefined || !args[index + 1] || args[index + 1].startsWith('--')) throw Error('invalid-ci-command-options');
    o[flag] = args[++index];
  }
  required(o, ['--out']);
  let output;
  if (command === 'manifest') {
    required(o, ['--job']); output = await statement(o, parseCiJob(await json(o['--job'])));
  } else if (command === 'sign') {
    required(o, ['--manifest', '--private-key', '--key-id']);
    output = signCiStatement(await json(o['--manifest']), { keyId: o['--key-id'], privateKeyPem: (await bytes(o['--private-key'], 8192)).toString('utf8') });
  } else if (command === 'verify') {
    required(o, ['--signed', '--trust']);
    const policy = parseCiTrustPolicy(await json(o['--trust']));
    output = verifyCiStatement(await json(o['--signed']), { trustPolicy: policy, expectedStatement: await statement(o, policy.expectedJob) });
  } else throw Error('unknown-ci-command');
  await writeFile(resolve(o['--out']), JSON.stringify(output, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  process.stdout.write(command === 'verify' ? 'Public artifact signature verified against separate trust policy; execution remains not attested.\n' : 'Public artifact integrity data saved; execution remains self-reported.\n');
}
main().catch(error => {
  const code = /^[a-z][a-z0-9-]{0,79}$/.test(error?.code ?? '') ? error.code : /^[a-z][a-z0-9-]{0,79}$/.test(error?.message ?? '') ? error.message : 'ci-provenance-unavailable';
  process.stderr.write('ReproShare CI provenance failed [' + code + ']. No execution attestation claimed.\n'); process.exitCode = 1;
});
