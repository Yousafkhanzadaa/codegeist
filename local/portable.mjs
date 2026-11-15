import { readFile, lstat, realpath } from 'node:fs/promises';
import { dirname, resolve, join, relative, sep, basename, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseServiceProfile, verificationSpecForProfile } from './workflow.mjs';
import { sha256 } from './protocol.mjs';
import { parseContractPayload, validateContractPayload } from './input-contract.mjs';
import { canonicalJson, VerificationError } from './json.mjs';
import { renderPortableRunner } from './portable-template.mjs';

const fail = code => { throw new VerificationError(code); };
const LIMIT = 140 * 1024;
const safePath = value => typeof value === 'string' && value.length <= 200 && /^[A-Za-z0-9_./-]+$/.test(value) && !isAbsolute(value) && !value.split('/').some(part => !part || part === '.' || part === '..');

function privateScalars(value, result = { strings: [], numbers: [] }) {
  if (Array.isArray(value)) value.forEach(child => privateScalars(child, result));
  else if (value && typeof value === 'object') Object.values(value).forEach(child => privateScalars(child, result));
  else if (typeof value === 'string' && value.length >= 4) result.strings.push(value);
  else if (typeof value === 'number') result.numbers.push(value);
  return result;
}

function portableCommand(command) {
  const executable = basename(command[0]);
  if (!['node', 'node.exe', 'python3', 'python', 'python.exe'].includes(executable)) fail('portable-runtime-not-supported');
  if (command.slice(1).some(arg => arg !== '{input}' && (!safePath(arg) || arg.startsWith('-')))) fail('portable-command-review-required');
  return [executable.startsWith('node') ? 'node' : 'python3', ...command.slice(1)];
}

/** Exports only explicitly reviewed, pinned code plus public requirements. Never embeds the original/report. */
export async function buildPortableRunner({ profile: rawProfile, cwd, fixtureJson, reviewedCode, privateSourceJson }) {
  if (reviewedCode !== true) fail('portable-code-review-required');
  const profile = parseServiceProfile(rawProfile);
  if (!validateContractPayload(parseContractPayload(fixtureJson), profile.contract).valid) fail('portable-fixture-invalid');
  const root = await realpath(resolve(cwd));
  const sources = {};
  const privateLiterals = privateSourceJson ? privateScalars(parseContractPayload(privateSourceJson)) : { strings: [], numbers: [] };
  const publicEnums = new Set();
  function enums(schema) {
    if (schema.public) for (const value of schema.enum ?? []) publicEnums.add(value);
    if (schema.type === 'object') Object.values(schema.properties).forEach(enums);
    if (schema.type === 'array') enums(schema.items);
  }
  enums(profile.contract.schema);
  const protectedLiterals = privateLiterals.strings.filter(value => !publicEnums.has(value));
  // A matching small numeric constant (0, 1, etc.) does not establish copied
  // input. Automated scanning is deliberately heuristic; explicit code review
  // covers all constants, short strings, computed/encoded secrets and metadata.
  const protectedNumbers = privateLiterals.numbers.filter(value => !publicEnums.has(value) && String(value).replace(/\D/g, '').length >= 4);
  let total = 0;
  for (const adapter of [profile.oracle.affected, profile.oracle.fixed].filter(Boolean)) {
    for (const file of adapter.files) {
      if (!safePath(file.path)) fail('portable-path-invalid');
      let target = root;
      for (const part of file.path.split('/')) {
        target = join(target, part);
        const stat = await lstat(target);
        if (stat.isSymbolicLink()) fail('portable-symlink-rejected');
      }
      const actual = await realpath(target);
      const rel = relative(root, actual);
      if (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep)) fail('portable-path-invalid');
      const stat = await lstat(actual);
      if (!stat.isFile() || stat.size > LIMIT) fail('portable-code-size-limit');
      const bytes = await readFile(actual);
      if (sha256(bytes) !== file.sha256) fail('portable-code-hash-mismatch');
      let source;
      try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fail('portable-text-code-required'); }
      if (protectedLiterals.some(value => source.includes(value))) fail('private-literal-in-portable-code');
      if (protectedNumbers.some(value => new RegExp('(^|[^A-Za-z0-9_.])' + String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z0-9_.])').test(source))) fail('private-numeric-literal-in-portable-code');
      if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:api[_-]?key|password|secret|access[_-]?token)\s*[:=]\s*["'][^"'\n]{8,}["']/i.test(source)) fail('possible-secret-in-portable-code');
      if (sources[file.path] && sources[file.path] !== source) fail('portable-revision-file-conflict');
      if (!sources[file.path]) total += bytes.length;
      if (total > 80 * 1024) fail('portable-code-size-limit');
      sources[file.path] = source;
    }
  }
  const normalise = adapter => ({ ...adapter, command: portableCommand(adapter.command) });
  const oracle = { ...profile.oracle, affected: normalise(profile.oracle.affected), ...(profile.oracle.fixed ? { fixed: normalise(profile.oracle.fixed) } : {}) };
  const runtimeRoot = dirname(fileURLToPath(import.meta.url));
  const runtime = {};
  for (const name of ['protocol.mjs', 'json.mjs', 'input-contract.mjs']) runtime[name] = await readFile(join(runtimeRoot, name), 'utf8');
  const manifest = { version: 1, profileId: profile.id, fixtureHash: sha256(fixtureJson), contract: profile.contract,
    spec: verificationSpecForProfile(profile), oracle, sources, runtime };
  // Source text remains ordinary JSON strings for inspection, never opaque base64.
  const runner = renderPortableRunner(manifest);
  if (Buffer.byteLength(runner) > LIMIT) fail('portable-runner-size-limit');
  return { runner, runnerHash: sha256(runner), testSpecHash: sha256(canonicalJson(manifest.spec)), declaredFiles: Object.keys(sources),
    disclosures: ['The runnable package contains explicitly reviewed application and test source. Inspect it before local execution.', 'Automatic secret/literal scanning is heuristic. The reviewer must inspect short strings, small numeric constants, encoded values, credentials and code comments too.', 'Original-input execution remains the source operator’s private self-report. The receiver independently executes only the synthetic fixture.', 'Only declared files are embedded. For a prepared dependency environment use --cwd /authorised/application after the fixture argument; pinned files must match. Replay failure is not a verified reproduction.'] };
}
