import type { Candidate, HandlerComparison, PrepareInput, PreparedRepro, ProfileId, ScanResult } from '../shared/contracts';
import { leavesOf, mapLeaves, parsePayload, PayloadError, sha256, valueAt, type JsonValue, type Leaf } from './json';
import { assertApplicationInput, attachApplicationCase } from './application-case';
import { constrainFixtures, inputContractHash, parseInputContract, validateContractPayload } from './input-contract';
import { hermesInputContract, deburrInputContract } from './default-contracts';
import { bindPreparedRepro } from './verification';
import { scanDeburrCase, prepareDeburrCase } from './deburr-case';
import { randomBytes } from 'node:crypto';
import knownVerificationSpecs from './known-verification-specs.json';
import { parseVerificationSpec } from './verification';

export { samplePayloads } from './samples';
export { INPUT_LIMITS, PayloadError } from './json';

interface Discovered {
  candidate: Candidate;
  leaves: Array<Leaf & { value: string }>;
}

const LIMITATIONS = [
  'Checks cover the selected supported condition and deterministic example handlers. They do not execute or reproduce the customer application.',
  'Field names, container structure, array lengths, and selected equality relationships remain visible. Field names can themselves contain sensitive information.',
  'Every string and number value in the generated fixture is synthesized; booleans are inverted and null remains null. Other business meanings and failure modes are not preserved.',
  'Synthetic output is not a guarantee of anonymization. Review every exported artifact before sharing.',
  'Input is limited to 64 KiB, 20 nesting levels and 2,000 JSON values. Duplicate and prototype-related keys and unsafe numeric literals are rejected.',
];

const PROFILE_TEXT: Record<ProfileId, { title: string; description: string; label: string }> = {
  precision: {
    title: 'Number conversion merges distinct ID strings',
    description: 'Distinct decimal identifier strings collapse to the same JavaScript Number. The declared expectation is exact string identity.',
    label: 'Distinct selected identities',
  },
  unicode: {
    title: 'NFC normalization merges distinct opaque IDs',
    description: 'Distinct identifier strings share an NFC form. This is a failure only when the application requires exact, unnormalized identity.',
    label: 'Distinct selected identities',
  },
  duplicates: {
    title: 'Repeated event IDs require idempotent handling',
    description: 'The selected event ID field repeats. The example handler processes each delivery; the fixed example processes each exact event ID once.',
    label: 'Events processed by the example handler',
  },
  diacritics: { title: 'Combining marks survive deburring', description: 'A bounded public text-normalization regression.', label: 'Strings retaining combining marks' },
  application: { title: 'Local application reproduction', description: 'A reviewed application-test workflow.', label: 'Declared application assertion' },
};

function identityField(field: string): boolean {
  return /(?:Id|ID|Uid|UID|Key|KEY|Number)$/.test(field)
    || /(?:^|[_-])(?:id|uid|uuid|key)$/.test(field.toLowerCase())
    || /^(?:id|uid|uuid|key|eventid|orderid|customerid|userid|accountid|transactionid|externalid|requestid|messageid|deliveryid|recordid)$/.test(field.toLowerCase());
}

function eventField(field: string, group: string): boolean {
  const normalized = field.toLowerCase().replace(/[_-]/g, '');
  return ['eventid', 'messageid', 'deliveryid', 'idempotencykey'].includes(normalized)
    || (normalized === 'id' && /"(?:events|messages|deliveries|webhooks)"/i.test(group));
}

function collisionKey(profile: ProfileId, value: string): string {
  if (profile === 'precision') return String(Number(value));
  if (profile === 'unicode') return value.normalize('NFC');
  return value;
}

function hasCollapsedIdentities(profile: ProfileId, values: string[]): boolean {
  return new Set(values.map(value => collisionKey(profile, value))).size < new Set(values).size;
}

function discover(root: JsonValue, allowAnyStringFields = false): Discovered[] {
  const groups = new Map<string, Array<Leaf & { value: string }>>();
  for (const leaf of leavesOf(root)) {
    if (typeof leaf.value !== 'string' || (!allowAnyStringFields && !identityField(leaf.fieldName))) continue;
    const group = groups.get(leaf.group) ?? [];
    group.push(leaf as Leaf & { value: string });
    groups.set(leaf.group, group);
  }
  const discovered: Discovered[] = [];
  for (const [group, leaves] of groups) {
    const add = (profileId: 'precision' | 'unicode' | 'duplicates', selected: Array<Leaf & { value: string }>) => {
      if (selected.length < 2) return;
      const values = selected.map(leaf => leaf.value);
      const matches = profileId === 'duplicates'
        ? new Set(values).size < values.length
        : hasCollapsedIdentities(profileId, values);
      if (!matches) return;
      const manuallyDiscoverable = identityField(selected[0].fieldName)
        && (profileId !== 'duplicates' || eventField(selected[0].fieldName, group));
      const text = manuallyDiscoverable ? PROFILE_TEXT[profileId] : {
        precision: {
          title: 'Number conversion merges distinct strings',
          description: 'Distinct decimal strings in this structural field group become the same JavaScript Number. Confirm that exact string identity matters before selecting this condition.',
        },
        unicode: {
          title: 'NFC normalization merges distinct strings',
          description: 'Distinct strings in this structural field group share an NFC form. Confirm that exact, unnormalized string identity matters before selecting this condition.',
        },
        duplicates: {
          title: 'Repeated strings in the same field group',
          description: 'This structural field group contains repeated string values. Repetition alone is not an error. Confirm that this field identifies events that should be processed only once before selecting the idempotency example.',
        },
        diacritics: PROFILE_TEXT.diacritics,
      }[profileId];
      discovered.push({
        candidate: {
          id: `${profileId}-${sha256(JSON.stringify([group, selected.map(leaf => leaf.parts)])).slice(0, 20)}`,
          profileId,
          title: text.title,
          description: text.description,
          fieldName: selected[0].fieldName,
          paths: selected.map(leaf => leaf.path),
          occurrenceCount: selected.length,
        },
        leaves: selected,
      });
    };
    add('precision', leaves.filter(leaf => /^-?\d{1,80}$/.test(leaf.value) && Number.isFinite(Number(leaf.value))));
    add('unicode', leaves.filter(leaf => leaf.value.length > 0 && leaf.value.length <= 256));
    if (allowAnyStringFields || eventField(leaves[0].fieldName, group)) add('duplicates', leaves);
  }
  const order: ProfileId[] = ['precision', 'unicode', 'duplicates'];
  return discovered.sort((a, b) => order.indexOf(a.candidate.profileId) - order.indexOf(b.candidate.profileId)
    || a.candidate.id.localeCompare(b.candidate.id));
}

export function scanPayload(sourceJson: string): ScanResult {
  const root = parsePayload(sourceJson);
  const candidates = [...discover(root).map(item => item.candidate), ...scanDeburrCase(root)];
  const warnings = [
    'Discovery is limited to supported string identifier fields. A suggested condition is not a diagnosis of the customer application.',
    'Shared output retains field names and JSON structure. Review keys as well as values before sharing.',
  ];
  if (!candidates.length) warnings.unshift('No supported condition was found. No reproduction or privacy claim has been made.');
  return { candidates, warnings, valueCount: leavesOf(root).length, sourceHash: sha256(sourceJson) };
}

/**
 * Broad discovery for a reviewed investigation. These observations do not infer
 * that a field is an identifier or that repeated values represent deliveries.
 * The caller must establish that meaning before enabling broad preparation.
 */
export function scanForInvestigation(sourceJson: string): ScanResult {
  const root = parsePayload(sourceJson);
  const candidates = [...discover(root, true).map(item => item.candidate), ...scanDeburrCase(root)];
  const warnings = [
    'Investigation examines structural string field groups regardless of field name. A verified relation is not a diagnosis or proof that a field represents identity.',
    'Confirm exact string identity or event idempotency before preparing a candidate. Repeated ordinary text can be expected and unrelated to the reported failure.',
    'Discovery contains field names, paths and counts, not source scalar values. Field names and structure can themselves reveal private information.',
  ];
  if (!candidates.length) warnings.unshift('No supported condition was found. No reproduction or privacy claim has been made.');
  return { candidates, warnings, valueCount: leavesOf(root).length, sourceHash: sha256(sourceJson) };
}

function uniqueInOrder<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function buildMappings(root: JsonValue, selected: Discovered, digest: string, signed64 = false): {
  synthetic: Map<string, string>;
  ordinary: Map<string, string>;
  numbers: Map<number, number>;
} {
  const sourceLeaves = leavesOf(root);
  const strings = uniqueInOrder(sourceLeaves.filter(leaf => typeof leaf.value === 'string').map(leaf => leaf.value as string));
  const originalStrings = new Set(strings);
  const originalNumbers = new Set(sourceLeaves.filter(leaf => typeof leaf.value === 'number').map(leaf => leaf.value as number));
  const synthetic = new Map<string, string>();
  const ordinary = new Map<string, string>();
  const numbers = new Map<number, number>();
  let stringCounter = 0;
  for (const source of strings) {
    let replacement: string;
    do { replacement = `synthetic_${digest.slice(0, 12)}_${++stringCounter}`; } while (originalStrings.has(replacement));
    synthetic.set(source, replacement);
    ordinary.set(source, replacement);
  }
  let numeric = -1_000_000 - parseInt(digest.slice(0, 6), 16);
  for (const leaf of sourceLeaves) {
    if (typeof leaf.value !== 'number' || numbers.has(leaf.value)) continue;
    while (originalNumbers.has(numeric)) numeric -= 1;
    numbers.set(leaf.value, numeric--);
  }

  const selectedValues = uniqueInOrder(selected.leaves.map(leaf => leaf.value));
  if (selected.candidate.profileId !== 'duplicates') {
    // Ordinary tokenization assigns distinct, small ASCII identifiers. It can
    // erase these collisions, unlike consistent tokenization of repeated IDs.
    let ordinaryId = (signed64 ? 1_000_000_000_000_000 : 1_000) + parseInt(digest.slice(0, 4), 16);
    for (const value of selectedValues) {
      while (originalStrings.has(String(ordinaryId))) ordinaryId += 1;
      ordinary.set(value, String(ordinaryId++));
    }
  }

  if (selected.candidate.profileId === 'precision') {
    const buckets = new Map<string, string[]>();
    for (const value of selectedValues) {
      const key = collisionKey('precision', value);
      const bucket = buckets.get(key) ?? [];
      bucket.push(value);
      buckets.set(key, bucket);
    }
    // At 2^70, adjacent representable Numbers are 2^18 apart. Each bounded
    // bucket uses at most 2,000 distinct integers within one rounding interval.
    let anchor = signed64
      ? (1n << 62n) + BigInt(parseInt(digest.slice(0, 8), 16)) * 4096n
      : (1n << 70n) + BigInt(parseInt(digest.slice(0, 8), 16)) * (1n << 22n);
    for (const bucket of buckets.values()) {
      let replacements: string[];
      do {
        anchor += signed64 ? 4096n : 1n << 22n;
        replacements = bucket.map((_, index) => String(anchor + BigInt(index + 1)));
      } while (replacements.some(value => originalStrings.has(value)));
      bucket.forEach((value, index) => synthetic.set(value, replacements[index]));
    }
  }
  if (selected.candidate.profileId === 'unicode') {
    const buckets = new Map<string, string[]>();
    for (const value of selectedValues) {
      const key = value.normalize('NFC');
      const bucket = buckets.get(key) ?? [];
      bucket.push(value);
      buckets.set(key, bucket);
    }
    let bucketIndex = 0;
    for (const bucket of buckets.values()) {
      const width = Math.max(1, Math.ceil(Math.log2(bucket.length)));
      let prefix: string;
      let replacements: string[];
      do {
        prefix = `rs_${digest.slice(0, 12)}_${++bucketIndex}_`;
        replacements = bucket.map((_, index) => prefix + Array.from({ length: width }, (_unused, bit) =>
          (index & (1 << bit)) === 0 ? '\u00e9' : 'e\u0301').join(''));
      } while (replacements.some(value => originalStrings.has(value)));
      bucket.forEach((value, index) => synthetic.set(value, replacements[index]));
    }
  }
  return { synthetic, ordinary, numbers };
}

function compare(profile: ProfileId, original: string[], ordinary: string[], synthetic: string[]): HandlerComparison {
  const exactCount = (values: string[]) => new Set(values).size;
  const faultyCount = (values: string[]) => profile === 'duplicates' ? values.length : new Set(values.map(value => collisionKey(profile, value))).size;
  return {
    label: PROFILE_TEXT[profile].label,
    expected: exactCount(original),
    source: faultyCount(original),
    ordinary: faultyCount(ordinary),
    synthetic: faultyCount(synthetic),
    fixed: exactCount(synthetic),
    unit: profile === 'duplicates' ? 'events' : 'identities',
  };
}

function quotedInline(text: string): string {
  const cleaned = text.replace(/[\r\n]/g, ' ');
  const runs = cleaned.match(/`+/g) ?? [];
  const fence = '`'.repeat(Math.max(1, ...runs.map(run => run.length + 1)));
  return `${fence} ${cleaned} ${fence}`;
}

function reportFor(repro: Omit<PreparedRepro, 'reportMarkdown' | 'harnessCode'>): string {
  const comparison = repro.comparison;
  return [
    '# ReproShare selected-condition reproduction',
    '',
    `Profile: **${PROFILE_TEXT[repro.profileId].title}**`,
    '',
    'This package contains synthetic values. Its checks verify a selected condition in deterministic example handlers; they do not establish that the customer application has been reproduced or that all sensitive information has been removed.',
    '',
    `Fixture SHA-256: ${quotedInline(repro.fixtureHash)}`,
    '',
    `## ${comparison.label}`,
    '',
    '| Declared expected count | Source / example handler | Ordinary aliases / example handler | Synthetic / example handler | Synthetic / fixed example |',
    '| --- | --- | --- | --- | --- |',
    `| ${comparison.expected} | ${comparison.source} | ${comparison.ordinary} | ${comparison.synthetic} | ${comparison.fixed} |`,
    '',
    repro.profileId === 'duplicates'
      ? 'Ordinary consistent aliases also preserve repeated IDs in this case. The comparison does not claim that ordinary tokenization destroys every reproduction.'
      : 'The ordinary-alias baseline removes the selected collision. The synthetic fixture retains it while replacing the identifier values.',
    '',
    '## Verification',
    '',
    ...repro.checks.map(check => `- ${check.passed ? 'PASS' : 'FAIL'} — ${check.label}: ${check.detail}`),
    '',
    '## Transformations',
    '',
    ...repro.transformations.map(change => `- ${quotedInline(change.path)} — ${change.rule}`),
    '',
    '## Limits and review',
    '',
    ...repro.limits.map(limit => `- ${limit}`),
    '',
    'Run the accompanying .mjs harness with Node.js to independently check the synthetic fixture, its hash, and the example-handler comparison. No third-party packages or customer application code are required.',
    '',
  ].join('\n');
}

function harnessFor(profile: ProfileId, ordinaryValues: string[], fixtureHash: string, paths: Leaf['parts'][], expected: number): string {
  return `// ReproShare: synthetic selected-condition harness.\n// Run: node repro.mjs [path/to/fixture.json]\n// Default filename: fixture.json. This does NOT run the customer application\n// or prove anonymization. No third-party packages are needed.\nimport assert from 'node:assert/strict';\nimport { createHash } from 'node:crypto';\nimport { readFileSync } from 'node:fs';\n\nconst profile = ${JSON.stringify(profile)};\nconst fixtureJson = readFileSync(process.argv[2] || 'fixture.json', 'utf8');\nconst ordinaryValues = ${JSON.stringify(ordinaryValues)};\nconst paths = ${JSON.stringify(paths)};\nconst expected = ${expected};\nconst fixture = JSON.parse(fixtureJson);\nconst at = (root, path) => path.reduce((item, part) => item[part], root);\nconst values = root => paths.map(path => at(root, path));\nconst exact = items => new Set(items).size;\nconst exampleHandler = items => profile === 'duplicates'\n  ? items.length\n  : new Set(items.map(value => profile === 'precision' ? Number(value) : value.normalize('NFC'))).size;\n// For these declared profiles, IDs are opaque exact strings. Duplicate-event\n// processing is idempotent; normalization/coercion is not an identity operation.\nconst fixedExampleHandler = items => exact(items);\n\nassert.equal(createHash('sha256').update(fixtureJson, 'utf8').digest('hex'), ${JSON.stringify(fixtureHash)}, 'Fixture hash differs');\nassert.ok(values(fixture).every(value => typeof value === 'string'), 'Selected values must be strings');\nassert.equal(exact(values(fixture)), expected, 'Synthetic exact-identity relation differs');\nassert.notEqual(exampleHandler(values(fixture)), expected, 'Selected condition was not retained');\nassert.equal(fixedExampleHandler(values(fixture)), expected, 'Fixed example does not meet declared count');\nif (profile === 'duplicates') {\n  assert.notEqual(exampleHandler(ordinaryValues), expected, 'Consistent aliases should retain repeated event IDs');\n} else {\n  assert.equal(exampleHandler(ordinaryValues), expected, 'Ordinary baseline should remove the selected collision');\n}\nconsole.log(JSON.stringify({\n  profile, expected, ordinary: exampleHandler(ordinaryValues),\n  synthetic: exampleHandler(values(fixture)), fixed: fixedExampleHandler(values(fixture)),\n  result: 'Selected condition verified; customer application not executed.'\n}, null, 2));\n`;
}

function pairsAreBijective(left: string[], right: string[]): boolean {
  const forward = new Map<string, string>();
  const reverse = new Map<string, string>();
  return left.every((value, index) => {
    const replacement = right[index];
    if ((forward.has(value) && forward.get(value) !== replacement)
      || (reverse.has(replacement) && reverse.get(replacement) !== value)) return false;
    forward.set(value, replacement);
    reverse.set(replacement, value);
    return true;
  });
}

function preparePatternRepro(input: PrepareInput, options?: { allowAnyStringFields?: boolean }): PreparedRepro {
  if (!input || typeof input.sourceJson !== 'string' || typeof input.candidateId !== 'string' || typeof input.seed !== 'string') {
    throw new PayloadError('Source JSON, a candidate ID and a seed string are required.');
  }
  if (input.seed.length > 256) throw new PayloadError('The generation seed must be at most 256 characters.');
  if (input.candidateId.length > 128) throw new PayloadError('Scan the payload again and select a current candidate.');
  const root = parsePayload(input.sourceJson);
  if (input.applicationCaseId !== undefined && input.applicationCaseId !== 'hermes-integer-coercion') throw new PayloadError('Select a supported application case.');
  const applicationCase = input.applicationCaseId === 'hermes-integer-coercion';
  if (applicationCase) assertApplicationInput(root);
  const sourceHash = sha256(input.sourceJson);
  const selected = discover(root, options?.allowAnyStringFields === true).find(item => item.candidate.id === input.candidateId);
  if (!selected) throw new PayloadError('This supported condition is no longer present. Scan the current payload and select a candidate.');
  const { candidate } = selected;
  if (applicationCase && candidate.profileId !== 'precision') throw new PayloadError('The Hermes case requires the Number-conversion candidate.');
  const sourceLeaves = leavesOf(root);
  const digest = sha256(JSON.stringify(['ReproShare/v1', input.seed, candidate.id, sourceHash]));
  const maps = buildMappings(root, selected, digest, applicationCase);
  const transform = (mapping: Map<string, string>) => (value: Leaf['value']): Leaf['value'] => {
    if (typeof value === 'string') return mapping.get(value)!;
    if (typeof value === 'number') return maps.numbers.get(value)!;
    if (typeof value === 'boolean') return !value;
    return null;
  };
  let fixture = mapLeaves(root, transform(maps.synthetic));
  let ordinary = mapLeaves(root, transform(maps.ordinary));
  const contract = input.inputContract !== undefined ? parseInputContract(input.inputContract) : applicationCase ? parseInputContract(hermesInputContract) : undefined;
  const constrained = contract ? constrainFixtures({ source: root, synthetic: fixture, ordinary, contract, profileId: candidate.profileId, selectedPaths: candidate.paths, seed: input.seed }) : undefined;
  if (constrained) { fixture = constrained.synthetic; ordinary = constrained.ordinary; }
  const fixtureJson = JSON.stringify(fixture, null, 2);
  const ordinaryJson = JSON.stringify(ordinary, null, 2);
  if (applicationCase) { assertApplicationInput(fixture); assertApplicationInput(ordinary); }
  const fixtureHash = sha256(fixtureJson);
  const values = (payload: JsonValue) => selected.leaves.map(leaf => valueAt(payload, leaf.parts) as string);
  const sourceValues = selected.leaves.map(leaf => leaf.value);
  const syntheticValues = values(fixture);
  const comparison = compare(candidate.profileId, sourceValues, values(ordinary), syntheticValues);
  const synthesizedLeaves = leavesOf(fixture);
  const originalStrings = new Set(sourceLeaves.filter(leaf => typeof leaf.value === 'string').map(leaf => leaf.value));
  const originalNumbers = new Set(sourceLeaves.filter(leaf => typeof leaf.value === 'number').map(leaf => leaf.value));
  const retainedPublicPaths = new Set(constrained?.retainedPublicPaths ?? []);
  const noCopiedStringsOrNumbers = synthesizedLeaves.every(leaf => retainedPublicPaths.has(leaf.path) || (typeof leaf.value === 'string'
    ? !originalStrings.has(leaf.value) : typeof leaf.value === 'number' ? !originalNumbers.has(leaf.value) : true));
  const sameIdentityRelations = pairsAreBijective(sourceValues, syntheticValues)
    && pairsAreBijective(sourceValues.map(value => collisionKey(candidate.profileId, value)),
      syntheticValues.map(value => collisionKey(candidate.profileId, value)));
  const selectedPaths = new Set(candidate.paths);
  const transformations = constrained?.transformations ?? sourceLeaves.map(leaf => ({
    path: leaf.path,
    rule: leaf.value === null ? 'Retained null structural marker'
      : typeof leaf.value === 'boolean' ? 'Inverted boolean; type retained'
        : typeof leaf.value === 'number' ? 'Generated a new safe integer; business meaning not retained'
          : selectedPaths.has(leaf.path) ? `Generated a synthetic identifier retaining the selected ${candidate.profileId} relation`
            : 'Replaced with a consistent synthetic string alias',
  }));
  const checks: PreparedRepro['checks'] = [
    { id: 'condition', label: 'Selected condition retained', passed: sameIdentityRelations && comparison.synthetic !== comparison.expected,
      detail: 'Exact equality and the selected collision/repetition relation match the source across the selected paths.' },
    { id: 'values', label: retainedPublicPaths.size ? 'Private string and number values replaced' : 'String and number values replaced', passed: noCopiedStringsOrNumbers,
      detail: retainedPublicPaths.size ? 'Original string and number leaves are replaced except explicitly declared public enum constants. Inspect the public schema and every retained constant.' : 'No original string or number leaf is reused in the synthetic fixture. Field names, booleans and null have the stated separate limits.' },
    { id: 'shape', label: 'JSON structure and scalar types retained', passed: sourceLeaves.length === synthesizedLeaves.length
      && sourceLeaves.every((leaf, index) => leaf.path === synthesizedLeaves[index].path && typeof leaf.value === typeof synthesizedLeaves[index].value),
      detail: 'Object keys, array lengths and scalar types are unchanged. This is not a check of business semantics.' },
    { id: 'fixed', label: 'Fixed example meets the declared result', passed: comparison.fixed === comparison.expected,
      detail: 'The fixed example uses exact string identity and processes duplicate event IDs only once where applicable.' },
    { id: 'baseline', label: 'Ordinary-alias comparison measured', passed: candidate.profileId === 'duplicates'
      ? comparison.ordinary === comparison.source : comparison.ordinary === comparison.expected,
      detail: candidate.profileId === 'duplicates'
        ? 'Ordinary consistent aliases also preserve repeated event IDs; the example handler still over-processes them.'
        : 'Distinct small ASCII aliases remove this selected collision in the example handler.' },
  ];
  if (constrained) checks.push({ id: 'input-validity', label: 'Declared input requirements satisfied', passed: true, detail: 'Original, ordinary replacement and synthetic fixture satisfy the bounded public input contract. Unlisted application preconditions remain unverified.' });
  if (checks.some(check => !check.passed)) throw new PayloadError('The synthetic fixture failed an internal verification. Nothing has been prepared for sharing.');
  const base: Omit<PreparedRepro, 'reportMarkdown' | 'harnessCode'> = {
    version: 1,
    profileId: candidate.profileId,
    title: `ReproShare — ${PROFILE_TEXT[candidate.profileId].title}`,
    sourceHash,
    fixtureHash,
    fixtureJson,
    selectedPaths: [...selectedPaths],
    ordinaryJson,
    comparison,
    checks,
    transformations,
    changedValueCount: sourceLeaves.filter((leaf, index) => !Object.is(leaf.value, synthesizedLeaves[index].value)).length,
    limits: constrained ? [...LIMITATIONS.filter((_, index) => index !== 2), ...constrained.disclosures] : [...LIMITATIONS],
    ...(constrained ? { inputContract: constrained.contract, inputContractHash: constrained.contractHash } : {}),
  };
  const prepared = {
    ...base,
    reportMarkdown: reportFor(base),
    harnessCode: harnessFor(candidate.profileId, values(ordinary), fixtureHash, selected.leaves.map(leaf => leaf.parts), comparison.expected),
  };
  return applicationCase ? attachApplicationCase(prepared) : prepared;
}

export function prepareRepro(input: PrepareInput, options?: { allowAnyStringFields?: boolean }): PreparedRepro {
  // An empty/default seed must not be a public candidate-confirmation oracle.
  // An explicitly chosen replay seed stays in the source-authorized workflow.
  input = { ...input, seed: input?.seed || randomBytes(32).toString('hex') };
  const finish = (repro: PreparedRepro) => {
    const declared = repro.applicationCase ? knownVerificationSpecs[repro.applicationCase.id] : input.verificationSpec;
    const bound = bindPreparedRepro({ ...repro, ...(declared ? { verificationSpec: parseVerificationSpec(declared) } : {}) });
    return bound.inputContract ? { ...bound,
      reportMarkdown: `${bound.reportMarkdown}\n## Declared public input requirements\n\nThe original, ordinary and synthetic inputs satisfy this bounded contract. It is not a complete model of application preconditions. Explicit public enum constants can remain visible.\n\n\`\`\`json\n${JSON.stringify(bound.inputContract, null, 2)}\n\`\`\`\n\nInput contract SHA-256: ${bound.inputContractHash}\nPublic package binding: ${bound.bindingId}\n`,
      // JSON escapes CR/LF, but literal U+2028/U+2029 also terminate a JS line
      // comment. Schema keys and explicitly public strings remain untrusted.
      harnessCode: `${bound.harnessCode}\n// Declared public input contract: ${JSON.stringify(bound.inputContract).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')}\n// Public package binding: ${bound.bindingId}\n`,
    } : bound;
  };
  if (input?.applicationCaseId === 'es-toolkit-deburr' || input?.candidateId?.startsWith('diacritics-')) {
    const repro = prepareDeburrCase(input);
    const contract = parseInputContract(input.inputContract ?? deburrInputContract);
    if (![input.sourceJson, repro.fixtureJson, repro.ordinaryJson].every(json => validateContractPayload(parsePayload(json), contract).valid)) throw new PayloadError('The deburring inputs do not satisfy the declared input requirements.');
    return finish({ ...repro, inputContract: contract, inputContractHash: inputContractHash(contract) });
  }
  return finish(preparePatternRepro(input, options));
}
