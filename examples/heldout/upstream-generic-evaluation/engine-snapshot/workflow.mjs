import { randomBytes, createHash } from 'node:crypto';
import { parseInputContract, parseContractPayload, validateContractPayload, inputContractHash } from './input-contract.mjs';
import { parseOracleConfiguration, runOracleInput } from './protocol.mjs';
import { canonicalJson, VerificationError } from './json.mjs';

const fail = code => { throw new VerificationError(code); };
const hash = text => createHash('sha256').update(text).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const token = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const escape = key => String(key).replace(/~/g, '~0').replace(/\//g, '~1');

export function parseServiceProfile(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['version', 'id', 'title', 'contract', 'oracle', 'budget'].includes(key)) || value.version !== 1 || !token.test(value.id)) fail('invalid-service-profile');
  if (value.title !== undefined && (typeof value.title !== 'string' || value.title.length > 160 || /[\u0000-\u001f]/.test(value.title))) fail('invalid-service-profile');
  const contract = parseInputContract(value.contract);
  const oracle = parseOracleConfiguration(value.oracle);
  if (oracle.id !== value.id) fail('service-oracle-id-mismatch');
  const budget = { maxRuns: 48, maxDurationMs: 45_000, repeats: 2, ...(value.budget ?? {}) };
  if (!value.budget || typeof value.budget === 'object') {
    if (Object.keys(budget).some(key => !['maxRuns', 'maxDurationMs', 'repeats'].includes(key)) || !Number.isInteger(budget.maxRuns) || budget.maxRuns < 8 || budget.maxRuns > 128
      || !Number.isInteger(budget.maxDurationMs) || budget.maxDurationMs < 500 || budget.maxDurationMs > 120_000 || !Number.isInteger(budget.repeats) || budget.repeats < 2 || budget.repeats > 3) fail('invalid-search-budget');
  } else fail('invalid-search-budget');
  return { version: 1, id: value.id, title: value.title ?? value.id, contract, oracle, budget };
}

export function verificationSpecForProfile(profile) {
  const binding = adapter => ({ revision: adapter.revision, files: adapter.files.map(file => ({ ...file })) });
  return { version: 1, id: profile.id, assertionId: profile.oracle.assertionId, failureKind: profile.oracle.failureKind,
    ...(profile.oracle.failureSite ? { failureSite: profile.oracle.failureSite } : {}), affected: binding(profile.oracle.affected), ...(profile.oracle.fixed ? { fixed: binding(profile.oracle.fixed) } : {}) };
}

function located(root, schema, path = '', result = []) {
  if (schema.type === 'object') for (const [key, value] of Object.entries(root)) located(value, schema.properties[key], path + '/' + escape(key), result);
  else if (schema.type === 'array') root.forEach((value, index) => located(value, schema.items, path + '/' + index, result));
  else result.push({ path, value: root, schema });
  return result;
}

function privateValues(root, contract) {
  return new Set(located(root, contract.schema).filter(item => !item.schema.public && ['string', 'number'].includes(typeof item.value)).map(item => JSON.stringify(item.value)));
}

/** Required private scalar values must not survive anywhere in a candidate. Keys/shape remain a separate disclosure. */
export function hasPrivateValue(candidate, original, contract) {
  const forbidden = privateValues(original, contract);
  return located(candidate, contract.schema).some(item => !item.schema.public && forbidden.has(JSON.stringify(item.value)));
}

function scalar(original, schema, attempt, salt, pointer, forbidden, aliases) {
  if (schema.public && schema.enum) return original;
  if (original === null) return null;
  if (typeof original === 'boolean') return !original;
  const cacheKey = canonicalJson([original, schema]);
  if (aliases.has(cacheKey)) return aliases.get(cacheKey);
  const digest = hash(canonicalJson([salt, original, attempt, pointer]));
  const choose = values => values.find(value => value !== undefined && !forbidden.has(JSON.stringify(value)));
  let result;
  if (typeof original === 'number') {
    const min = schema.minimum ?? -1_000_000;
    const max = schema.maximum ?? 1_000_000;
    const options = [Math.max(min, Math.min(max, attempt + 1)), original + 1, original - 1, min, max, original + 2, original - 2];
    result = choose([...options.slice(attempt % options.length), ...options.slice(0, attempt % options.length)].filter(value => Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER && value >= min && value <= max && (!schema.integer || Number.isInteger(value))));
  } else if (schema.format === 'integer-string') {
    const min = BigInt(schema.minimum ?? '-9223372036854775808');
    const max = BigInt(schema.maximum ?? '9223372036854775807');
    const source = BigInt(original);
    const choices = [BigInt(attempt + 1), source + BigInt(attempt + 1), source - BigInt(attempt + 1), min, max, 9007199254740992n + BigInt(attempt)];
    result = choose(choices.filter(value => value >= min && value <= max).map(String));
  } else if (schema.format === 'email') result = 'case' + digest.slice(0, 12) + '@example.test';
  else if (schema.format === 'url') result = 'https://example.test/case/' + digest.slice(0, 16);
  else if (schema.format === 'date' || schema.format === 'date-time') {
    const value = new Date(original + (schema.format === 'date' ? 'T00:00:00.000Z' : ''));
    if (attempt % 2) value.setUTCFullYear(value.getUTCFullYear() + 4 + 4 * Math.floor(attempt / 2));
    else value.setUTCDate(value.getUTCDate() + 7 + attempt);
    result = schema.format === 'date' ? value.toISOString().slice(0, 10) : value.toISOString();
  } else {
    const sourceLength = [...original].length;
    const lengths = [8, sourceLength, schema.minLength ?? 0, schema.maxLength ?? Math.max(64, sourceLength), 1, 2, 15, 16, 17, 31, 32, 33, 63, 64, 65, 127, 128, 255, 256];
    const length = Math.max(schema.minLength ?? 0, Math.min(schema.maxLength ?? 4096, lengths[attempt % lengths.length]));
    result = (digest.repeat(Math.ceil(Math.max(1, length) / digest.length))).slice(0, length);
  }
  if (result === undefined || forbidden.has(JSON.stringify(result))) fail('private-value-cannot-change');
  aliases.set(cacheKey, result);
  return result;
}

function generate(original, contract, attempt, salt) {
  const forbidden = privateValues(original, contract);
  const aliases = new Map();
  function visit(value, schema, path) {
    if (schema.type === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, visit(child, schema.properties[key], path + '/' + escape(key))]));
    if (schema.type === 'array') return value.map((child, index) => visit(child, schema.items, path + '/' + index));
    return scalar(value, schema, attempt, salt, path, forbidden, aliases);
  }
  return visit(original, contract.schema, '');
}

function removals(root, schema, path = []) {
  const choices = [];
  if (schema.type === 'object') for (const [key, child] of Object.entries(root)) {
    if (!schema.required?.includes(key)) choices.push([...path, key]);
    choices.push(...removals(child, schema.properties[key], [...path, key]));
  }
  else if (schema.type === 'array') {
    if (root.length > (schema.minItems ?? 0)) for (let index = root.length - 1; index >= 0; index--) choices.push([...path, index]);
    root.forEach((child, index) => choices.push(...removals(child, schema.items, [...path, index])));
  }
  return choices;
}

function remove(root, path) {
  const next = clone(root);
  let parent = next;
  for (const token of path.slice(0, -1)) parent = parent[token];
  if (Array.isArray(parent)) parent.splice(path.at(-1), 1); else delete parent[path.at(-1)];
  return next;
}

/** Bounded search using real application feedback. No case-specific bug detector or uploaded code execution. */
export async function synthesizeWorkflow({ sourceJson, profile: rawProfile, cwd, allowCommand, onProgress, signal }) {
  const profile = parseServiceProfile(rawProfile);
  const original = parseContractPayload(sourceJson);
  if (!validateContractPayload(original, profile.contract).valid) fail('original-input-invalid');
  if (allowCommand !== true) fail('command-consent-required');
  const salt = randomBytes(32).toString('hex');
  const started = Date.now();
  const stats = { runs: 0, candidates: 0, invalidCandidates: 0, differentOutcomes: 0, minimizationChecks: 0, removedParts: 0 };
  const decisions = [];
  const budget = profile.budget;
  let baselineFingerprint;
  const exhausted = () => signal?.aborted || stats.runs >= budget.maxRuns || Date.now() - started >= budget.maxDurationMs;
  async function check(payload, expected = 'fail') {
    if (signal?.aborted) fail('search-cancelled');
    if (exhausted()) return null;
    const remaining = budget.maxDurationMs - (Date.now() - started);
    if (remaining < 10) return null;
    const oracle = { ...profile.oracle, limits: { ...profile.oracle.limits, timeoutMs: Math.min(profile.oracle.limits?.timeoutMs ?? 5000, remaining) } };
    stats.runs++;
    onProgress?.({ ...stats, phase: 'running', elapsedMs: Date.now() - started });
    const result = await runOracleInput({ oracle, cwd, input: JSON.stringify(payload, null, 2), allowCommand: true, expectedOutcome: expected });
    return result;
  }
  async function matches(payload) {
    let fingerprint;
    for (let repeat = 0; repeat < budget.repeats; repeat++) {
      const result = await check(payload);
      if (!result || result.outcome !== 'fail' || !result.matchedExpected) return false;
      const observed = canonicalJson([result.assertionId, result.failureKind, result.failureSite ?? null]);
      if (fingerprint !== undefined && fingerprint !== observed || baselineFingerprint !== undefined && baselineFingerprint !== observed) return false;
      fingerprint = observed;
    }
    baselineFingerprint ??= fingerprint;
    return true;
  }
  if (!await matches(original)) fail(exhausted() ? 'search-budget-exhausted' : 'original-failure-not-stable');
  let ordinary;
  let fixture;
  for (let attempt = 0; attempt < 32 && !exhausted(); attempt++) {
    let candidate;
    try { candidate = generate(original, profile.contract, attempt, salt); }
    catch (error) { if (error?.code === 'private-value-cannot-change') { stats.invalidCandidates++; continue; } throw error; }
    if (!validateContractPayload(candidate, profile.contract).valid || hasPrivateValue(candidate, original, profile.contract)) { stats.invalidCandidates++; continue; }
    if (!ordinary) ordinary = clone(candidate);
    stats.candidates++;
    if (await matches(candidate)) { fixture = candidate; decisions.push('changed-values-preserved-declared-failure'); break; }
    stats.differentOutcomes++;
  }
  if (!fixture) fail(exhausted() ? 'search-budget-exhausted' : 'no-safe-failing-variant');
  let keepTrying = true;
  while (keepTrying && !exhausted()) {
    keepTrying = false;
    for (const path of removals(fixture, profile.contract.schema)) {
      if (exhausted()) break;
      const candidate = remove(fixture, path);
      if (!validateContractPayload(candidate, profile.contract).valid || hasPrivateValue(candidate, original, profile.contract)) continue;
      stats.minimizationChecks++;
      if (await matches(candidate)) { fixture = candidate; stats.removedParts++; keepTrying = true; break; }
    }
  }
  if (!ordinary) fail('no-valid-control');
  const summary = { version: 1, kind: 'reproshare-search-summary', ...stats, elapsedMs: Date.now() - started,
    originalBytes: Buffer.byteLength(sourceJson), fixtureBytes: Buffer.byteLength(JSON.stringify(fixture, null, 2)),
    scope: 'bounded-local-search-not-global-minimum', stoppedByBudget: exhausted(), decisions,
    disclosures: ['Object keys, required structure, public constants and selected constraints remain visible.', 'Boolean inversion is reversible; changed booleans do not hide their original value.', 'Matching declared assertion/site is bounded failure evidence, not proof of identical root cause.'] };
  return { fixtureJson: JSON.stringify(fixture, null, 2), ordinaryJson: JSON.stringify(ordinary, null, 2), inputContract: profile.contract,
    verificationSpec: verificationSpecForProfile(profile), testSpecHash: hash(canonicalJson(verificationSpecForProfile(profile))),
    inputContractHash: inputContractHash(profile.contract), configurationHash: randomBytes(32).toString('hex'), searchSummary: summary };
}
