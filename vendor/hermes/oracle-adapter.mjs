#!/usr/bin/env node
// Thin protocol adapter around the unchanged Hermes upstream regression probe.
// The probe calls argument coercion only; no handler/model/network is executed.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function reject() { process.stderr.write('Hermes oracle unavailable.\n'); process.exit(2); }
const [revision, input, ...extra] = process.argv.slice(2);
if (!['before', 'fixed'].includes(revision) || !input || extra.length) reject();
const directory = dirname(fileURLToPath(import.meta.url));
const python = 'python3';
const isolated = { encoding: 'utf8', timeout: 10_000, maxBuffer: 16_384, windowsHide: true };
const version = spawnSync(python, ['-I', '-S', '-c', 'import sys; raise SystemExit(0 if sys.version_info >= (3,11) else 1)'], isolated);
if (version.error || version.status !== 0) reject();
const child = spawnSync(python, ['-I', '-S', join(directory, '../../scripts/hermes-adapter.py'), join(directory, revision), input], isolated);
if (child.error || ![0, 1].includes(child.status)) reject();
let result;
try { result = JSON.parse(child.stdout); } catch { reject(); }
if (result?.entrypoint !== 'model_tools.coerce_tool_args'
  || result.assertion !== 'each registered integer tool argument equals its exact input integer'
  || typeof result.passed !== 'boolean' || result.passed !== (child.status === 0)
  || result.exactIntegerArguments !== result.passed || result.toolHandlerExecuted !== false
  || !Number.isInteger(result.expectedDistinct) || result.expectedDistinct < 1 || result.expectedDistinct > 32
  || !Number.isInteger(result.observedDistinct) || result.observedDistinct < 1 || result.observedDistinct > 32
  || (result.passed && result.observedDistinct !== result.expectedDistinct)) reject();
const failureKind = result.observedDistinct < result.expectedDistinct ? 'integer-precision-collision' : 'integer-mismatch-without-collision';
process.stdout.write(JSON.stringify({ version: 1, assertionId: 'hermes.coerce-tool-args.exact-integer.v1', outcome: result.passed ? 'pass' : 'fail',
  ...(result.passed ? {} : { failureKind }) }) + '\n');
