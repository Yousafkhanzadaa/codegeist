#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runVerification } from '../local/protocol.mjs';

const usage = `ReproShare local application verification

Package mode (recommended):
  node scripts/reproshare-check.mjs --package verification-inputs.json \\
    --source private-original.json --oracle oracle.json --cwd /absolute/owned-app \\
    --allow-command --out verification-evidence.json

Explicit input mode:
  node scripts/reproshare-check.mjs --contract contract.json --source private.json \\
    --ordinary ordinary.json --fixture fixture.json --configuration-hash SHA256 \\
    --oracle oracle.json --cwd /absolute/owned-app --allow-command --out evidence.json

--allow-command authorizes the oracle's configured LOCAL executables. This is
not an OS sandbox. Inspect the oracle and its code before running it. Forge does
not receive commands or the private source. Only the bounded evidence is saved.

A fixed adapter is optional. A verified original/synthetic failure is reported
as failure-reproduced; a configured fix must pass all three inputs to earn
fix-validated. The ordinary replacement is a measured control, not a pass gate.
Set oracle limits.repetitions (1–3) to reject inconsistent repeated outcomes.
`;
const names = {
  '--package': 'packagePath', '--contract': 'contractPath', '--source': 'sourcePath',
  '--ordinary': 'ordinaryPath', '--fixture': 'fixturePath', '--oracle': 'oraclePath',
  '--cwd': 'cwd', '--configuration-hash': 'configurationHash', '--out': 'outputPath',
};
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') { process.stdout.write(usage); return; }
  const options = { allowCommand: false };
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--allow-command') {
      if (options.allowCommand) throw Error('duplicate-option');
      options.allowCommand = true;
    } else {
      const name = names[flag];
      if (!name || options[name] !== undefined || !args[index + 1] || args[index + 1].startsWith('--')) throw Error('invalid-command-options');
      options[name] = args[++index];
    }
  }
  if (!options.outputPath) throw Error('output-path-required');
  const report = await runVerification(options);
  // Refuse to overwrite source/configuration by requiring a new evidence file.
  await writeFile(resolve(options.outputPath), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  process.stdout.write(`ReproShare local verification: ${report.verdict}. Evidence saved.\n`);
  process.exitCode = report.verdict === 'verified' ? 0 : 2;
}
main().catch(error => {
  const known = typeof error?.code === 'string' && /^[a-z][a-z0-9-]{0,79}$/.test(error.code) ? error.code
    : typeof error?.message === 'string' && /^[a-z][a-z0-9-]{0,79}$/.test(error.message) ? error.message : 'verification-unavailable';
  process.stderr.write(`ReproShare check failed [${known}]. No successful proof accepted.\n`);
  process.exitCode = 1;
});
