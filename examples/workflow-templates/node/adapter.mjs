// Template only: connect your real application in application-test.mjs.
// This adapter does not invent a failure from a subprocess exit code.
import { readFileSync } from 'node:fs';
import { checkSelectedInvariant } from './application-test.mjs';

const payload = JSON.parse(readFileSync(process.argv[2], 'utf8'));
// Return true if this exact invariant holds, false if this exact invariant
// fails. Unexpected application/setup exceptions must propagate as errors.
const passed = await checkSelectedInvariant(payload);
if (typeof passed !== 'boolean') throw Error('application-check-must-return-boolean');
process.stdout.write(JSON.stringify({ version: 1, assertionId: 'service.selected-invariant.v1', outcome: passed ? 'pass' : 'fail',
  ...(!passed ? { failureKind: 'selected-invariant-failed', failureSite: 'service.selected-assertion.v1' } : {}) }) + '\n');
