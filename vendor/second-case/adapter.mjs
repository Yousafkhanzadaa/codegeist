#!/usr/bin/env node
// ReproShare adapter. Upstream deburr.ts files are complete and unchanged.
// Run: node adapter.mjs --revision affected|fixed INPUT_JSON_PATH
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const assertionId = 'es-toolkit.deburr.removes-supported-combining-marks.v1';
const base = dirname(fileURLToPath(import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const isMark = point => (point >= 0x0300 && point <= 0x036f)
  || (point >= 0x20d0 && point <= 0x20ff) || (point >= 0xfe20 && point <= 0xfe2f);

try {
  const args = process.argv.slice(2);
  if (Number(process.versions.node.split('.')[0]) < 24 || args.length !== 3
    || args[0] !== '--revision' || !['affected', 'fixed'].includes(args[1])) throw Error();
  const manifest = JSON.parse(readFileSync(join(base, 'provenance.json'), 'utf8'));
  for (const [name, file] of Object.entries(manifest.files)) {
    if (!/^(affected|fixed)\/(deburr\.ts|LICENSE)$/.test(name)
      || hash(readFileSync(join(base, name))) !== file.sha256) throw Error();
  }
  const inputPath = resolve(args[2]);
  if (!statSync(inputPath).isFile() || statSync(inputPath).size > 4096) throw Error();
  const raw = readFileSync(inputPath, 'utf8');
  // Exactly one JSON property. This rejects duplicate keys before JSON.parse
  // can silently discard them. Escaped spelling of the key remains valid.
  const stringToken = '"(?:[^"\\\\\\u0000-\\u001f]|\\\\(?:["\\\\/bfnrt]|u[0-9a-fA-F]{4}))*"';
  const whitespace = '[ \\t\\r\\n]*';
  const match = raw.match(new RegExp('^' + whitespace + '\\{' + whitespace + '(' + stringToken + ')'
    + whitespace + ':' + whitespace + '(' + stringToken + ')' + whitespace + '\\}' + whitespace + '$'));
  if (!match || JSON.parse(match[1]) !== 'text') throw Error();
  const text = JSON.parse(match[2]);
  const points = [...text];
  if (points.length < 1 || points.length > 256 || !/[A-Za-z0-9]/.test(text)
    || points.some(char => { const point = char.codePointAt(0); return !(point >= 0x20 && point <= 0x7e) && !isMark(point); })) throw Error();
  const { deburr } = await import(pathToFileURL(join(base, args[1], 'deburr.ts')).href);
  const actual = deburr(text);
  const expected = points.filter(char => !isMark(char.codePointAt(0))).join('');
  const passed = actual === expected;
  const result = { version: 1, assertionId, outcome: passed ? 'pass' : 'fail' };
  if (!passed) result.failureKind = [...actual].some(char => isMark(char.codePointAt(0)))
    ? 'combining-mark-retained' : 'deburr-contract-mismatch';
  process.stdout.write(JSON.stringify(result) + '\n');
} catch {
  // Never emit fixture values, path names, exceptions or upstream output.
  process.stderr.write('The es-toolkit oracle rejected the input or runtime setup.\n');
  process.exitCode = 1;
}
