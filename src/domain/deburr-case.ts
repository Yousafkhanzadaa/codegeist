import type { ApplicationCase, Candidate, PrepareInput, PreparedRepro } from '../shared/contracts';
import { parsePayload, PayloadError, sha256, type JsonValue } from './json';
import { DEBURR_ADAPTER, DEBURR_ADAPTER_SHA256, DEBURR_FILES, DEBURR_HARNESS_TEMPLATE } from './deburr-bundle';

export const DEBURR_ASSERTION_ID = 'es-toolkit.deburr.removes-supported-combining-marks.v1';
export const DEBURR_FAILURE_KIND = 'combining-mark-retained';
export const DEBURR_CASE: ApplicationCase = {
  id: 'es-toolkit-deburr',
  title: 'es-toolkit: combining marks survive deburr',
  issueUrl: 'https://github.com/toss/es-toolkit/pull/1807',
  fixUrl: 'https://github.com/toss/es-toolkit/pull/1807',
  affectedRevision: '282174c916c5ce125fe40eb5e952072cef2e97ce',
  proposedFixRevision: '4f5e0074714a3d1ed943dfb08cda77217e34ead2',
  entrypoint: 'src/string/deburr.ts:deburr',
  inputContract: 'Only {text:string}; 1–256 Unicode code points; printable ASCII plus U+0300–036F, U+20D0–20FF and U+FE20–FE2F; at least one ASCII letter or digit.',
  requirements: ['Node.js 24 or later with built-in TypeScript support', 'Offline: unchanged complete MIT modules and license notices are embedded; no packages, model or provider keys required.'],
  scope: 'Calls the complete unchanged es-toolkit deburr string function directly, without imports or runtime dependencies. The public report and merged fix are PR #1807; the fixed commit was merged on 2026-06-27. This is a real library entry point, not a complete customer application. The bounded input contract excludes unrelated Unicode transformations. Preparation checks the trigger relation; actual application execution happens locally in the downloaded runner.',
  status: 'runner-ready',
};

const candidateId = 'diacritics-' + sha256(JSON.stringify(['es-toolkit-deburr', '$.text'])).slice(0, 20);
const isMark = (point: number) => (point >= 0x0300 && point <= 0x036f)
  || (point >= 0x20d0 && point <= 0x20ff) || (point >= 0xfe20 && point <= 0xfe2f);
const isOmittedMark = (point: number) => (point >= 0x20d0 && point <= 0x20ff) || (point >= 0xfe24 && point <= 0xfe2f);
const omitted = [...Array.from({ length: 48 }, (_, i) => 0x20d0 + i), ...Array.from({ length: 12 }, (_, i) => 0xfe24 + i)];
const supported = [...Array.from({ length: 112 }, (_, i) => 0x0300 + i), ...Array.from({ length: 4 }, (_, i) => 0xfe20 + i)];
const ascii = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const omittedCount = (value: string) => [...value].filter(char => isOmittedMark(char.codePointAt(0)!)).length;

export function assertDeburrInput(root: JsonValue): asserts root is { text: string } {
  if (!root || typeof root !== 'object' || Array.isArray(root) || Object.keys(root).length !== 1 || typeof root.text !== 'string') {
    throw new PayloadError('The es-toolkit case requires only a text string.');
  }
  const points = [...root.text];
  if (points.length < 1 || points.length > 256 || !/[A-Za-z0-9]/.test(root.text)
    || points.some(char => { const point = char.codePointAt(0)!; return !(point >= 0x20 && point <= 0x7e) && !isMark(point); })) {
    throw new PayloadError('The es-toolkit text must contain 1–256 code points: printable ASCII plus the three supported combining-mark ranges, including an ASCII letter or digit.');
  }
}

export function scanDeburrCase(root: JsonValue): Candidate[] {
  try { assertDeburrInput(root); } catch { return []; }
  const count = omittedCount(root.text);
  if (!count) return [];
  return [{
    id: candidateId, profileId: 'diacritics', title: 'Combining marks survive es-toolkit deburr',
    description: 'Text contains combining marks omitted by the pinned affected deburr implementation. Confirm that this text is expected to be deburred before selecting the case.',
    paths: ['$.text'], fieldName: 'text', occurrenceCount: count,
  }];
}

function applicationHarness(repro: PreparedRepro): string {
  const config = { case: DEBURR_CASE, assertionId: DEBURR_ASSERTION_ID, failureKind: DEBURR_FAILURE_KIND,
    fixtureHash: repro.fixtureHash, ordinaryJson: repro.ordinaryJson, original: { text: 'a\u20dbb' },
    files: DEBURR_FILES, adapter: DEBURR_ADAPTER, adapterSha256: DEBURR_ADAPTER_SHA256 };
  return DEBURR_HARNESS_TEMPLATE.replace('__REPROSHARE_PACKAGE_DATA__', () => JSON.stringify(config));
}

export function prepareDeburrCase(input: PrepareInput): PreparedRepro {
  if (!input || typeof input.sourceJson !== 'string' || typeof input.candidateId !== 'string' || typeof input.seed !== 'string'
    || input.seed.length > 256 || input.candidateId.length > 128) throw new PayloadError('Source JSON, a current candidate and a seed of at most 256 characters are required.');
  if (input.applicationCaseId !== undefined && input.applicationCaseId !== 'es-toolkit-deburr') throw new PayloadError('Select the es-toolkit application case for this condition.');
  const root = parsePayload(input.sourceJson);
  assertDeburrInput(root);
  if (!scanDeburrCase(root).some(candidate => candidate.id === input.candidateId)) throw new PayloadError('This combining-mark condition is no longer present. Scan again.');
  const sourceHash = sha256(input.sourceJson);
  let nonce = 0;
  let generated = '';
  let ordinary = '';
  do {
    const digest = sha256(JSON.stringify(['ReproShare/deburr/v1', input.seed, sourceHash, nonce++]));
    const choice = (index: number) => parseInt(sha256(digest + ':' + index).slice(0, 8), 16);
    generated = [...root.text].map((char, index) => {
      const point = char.codePointAt(0)!;
      const pool = isOmittedMark(point) ? omitted : isMark(point) ? supported : undefined;
      if (!pool) return ascii[choice(index) % ascii.length];
      const other = pool.filter(mark => mark !== point);
      return String.fromCodePoint(other[choice(index) % other.length]);
    }).join('');
    ordinary = [...root.text].map((_char, index) => ascii[choice(index + 512) % ascii.length]).join('');
  } while (generated === root.text || ordinary === root.text);
  const fixture = { text: generated };
  const ordinaryRoot = { text: ordinary };
  assertDeburrInput(fixture); assertDeburrInput(ordinaryRoot);
  const fixtureJson = JSON.stringify(fixture, null, 2);
  const ordinaryJson = JSON.stringify(ordinaryRoot, null, 2);
  const sourceCount = omittedCount(root.text);
  const syntheticCount = omittedCount(generated);
  const limits = [
    'Preparation checks the supported combining-mark relation. Only the downloaded local runner executes the real pinned es-toolkit function.',
    'This case verifies one library entry point under the stated bounded input contract; it does not execute a complete customer application.',
    'The text value changes, while the field name, code-point length, combining-mark positions and trigger counts remain visible.',
    'The merged upstream fix passes this bounded assertion; this does not establish that all Unicode inputs or downstream application behavior are correct.',
    'Synthetic output is not a guarantee of anonymization. Review all exported artifacts before sharing. Arbitrary private source text is never embedded in the report or runner.',
  ];
  const repro: PreparedRepro = {
    version: 1, profileId: 'diacritics', title: 'ReproShare — es-toolkit combining-mark regression',
    sourceHash, fixtureHash: sha256(fixtureJson), fixtureJson, selectedPaths: ['$.text'], ordinaryJson,
    applicationCase: { ...DEBURR_CASE },
    checks: [
      { id: 'condition', label: 'Selected combining-mark condition retained', passed: sourceCount > 0 && syntheticCount === sourceCount, detail: 'The count of marks omitted by the affected implementation is preserved. This is a preparation check, not upstream execution.' },
      { id: 'values', label: 'Text value replaced', passed: generated !== root.text && ordinary !== root.text, detail: 'The complete source scalar is absent from both generated replacements. Individual characters and structural information can overlap.' },
      { id: 'shape', label: 'Input shape and text length retained', passed: [...generated].length === [...root.text].length && [...ordinary].length === [...root.text].length, detail: 'The only field remains text; both replacements satisfy the same bounded format and code-point length.' },
      { id: 'baseline', label: 'Ordinary replacement erases the trigger', passed: omittedCount(ordinary) === 0, detail: 'Ordinary replacement contains only ASCII. The local oracle must independently establish the affected implementation passes it.' },
      { id: 'fixed', label: 'Declared reference result has no retained marks', passed: true, detail: 'Expected retained-mark count is zero. Actual fixed-revision execution is required in the downloaded runner.' },
    ],
    comparison: { label: 'Omitted combining marks retained (preparation reference)', expected: 0, source: sourceCount, ordinary: 0, synthetic: syntheticCount, fixed: 0, unit: 'marks' },
    transformations: [{ path: '$.text', rule: 'Synthesized ASCII content and changed every combining mark within its supported or omitted range; retained code-point length and trigger count.' }],
    changedValueCount: 1, limits, reportMarkdown: '', harnessCode: '',
  };
  if (repro.checks.some(check => !check.passed)) throw new PayloadError('The fixture failed preparation checks. Nothing has been prepared for sharing.');
  repro.reportMarkdown = [
    '# Real upstream library regression — runner ready', '',
    'Public report and merged fix: ' + DEBURR_CASE.issueUrl, 'Affected revision: ' + DEBURR_CASE.affectedRevision,
    'Merged fixed revision: ' + DEBURR_CASE.proposedFixRevision, 'Entry point: ' + DEBURR_CASE.entrypoint, '',
    DEBURR_CASE.inputContract, '',
    'es-toolkit PR #1807 reports that deburr leaves combining marks from U+20D0–20FF and U+FE24–FE2F in valid input. The fix was merged on June 27, 2026. This case imports the complete unchanged affected and fixed modules with their MIT notices; it does not rewrite the upstream function.', '',
    'The same assertion applies to every valid input: all three declared combining-mark ranges are removed and the ASCII content is preserved. Ordinary ASCII replacement loses the trigger; generated text changes the source value while retaining it.', '',
    'Run node repro.mjs fixture.json using Node.js 24+. The runner compares original, ordinary replacement and the exact generated fixture on both revisions. It accepts a proof only when original and synthetic fail with the same assertion and failure identity, ordinary passes, and the merged fix passes all three. No network, model, provider key or package installation is required.', '',
    'Default original is the public reported input. Use --source private-local-source.json to verify a private original locally; its contents are not printed. Application status at preparation is RUNNER READY. No actual application result is claimed until local execution.', '',
    'Fixture SHA-256: ' + repro.fixtureHash, '', ...limits.map(limit => '- ' + limit),
  ].join('\n');
  repro.harnessCode = applicationHarness(repro);
  return repro;
}
