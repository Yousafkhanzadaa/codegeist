import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareRepro, samplePayloads, scanForInvestigation, scanPayload } from '../../src/domain';
import type { ProfileId } from '../../src/shared/contracts';
type PatternProfile = Exclude<ProfileId, 'diacritics' | 'application'>;
const packageContent = ({ bindingId: _binding, configurationHash: _privateConfiguration, ...content }: ReturnType<typeof prepareRepro>) => content;

const temporaryDirectories: string[] = [];
afterEach(() => temporaryDirectories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })));

const unusualSources: Record<PatternProfile, string> = {
  precision: JSON.stringify({ rows: [
    { unusual_reference: '9007199254740992' },
    { unusual_reference: '9007199254740993' },
  ] }),
  unicode: JSON.stringify({ rows: [
    { opaque_reference: 'private-caf\u00e9' },
    { opaque_reference: 'private-cafe\u0301' },
  ] }),
  duplicates: JSON.stringify({ rows: [
    { correlation_token: 'private-event-alpha' },
    { correlation_token: 'private-event-alpha' },
    { correlation_token: 'private-event-beta' },
  ] }),
};

describe('broader investigation discovery', () => {
  it.each(['precision', 'unicode', 'duplicates'] as PatternProfile[])('finds a verified %s relation with a nonstandard field name', profile => {
    const sourceJson = unusualSources[profile];
    expect(scanPayload(sourceJson).candidates).toEqual([]);
    const result = scanForInvestigation(sourceJson);
    const candidate = result.candidates.find(item => item.profileId === profile);
    expect(candidate).toBeDefined();
    expect(candidate!.occurrenceCount).toBe(profile === 'duplicates' ? 3 : 2);
    expect(result).toEqual(scanForInvestigation(sourceJson));
    expect(result.sourceHash).toBe(createHash('sha256').update(sourceJson).digest('hex'));
    expect(result.warnings.join(' ')).toContain('not a diagnosis');
    expect(result.warnings.join(' ')).toContain('Confirm');
  });

  it.each(['precision', 'unicode', 'duplicates'] as PatternProfile[])('retains identical candidate IDs and metadata for existing manual %s discoveries', profile => {
    const sourceJson = samplePayloads[profile].json;
    const manual = scanPayload(sourceJson);
    const investigation = scanForInvestigation(sourceJson);
    for (const candidate of manual.candidates) {
      expect(investigation.candidates.find(item => item.id === candidate.id)).toEqual(candidate);
    }
    expect(investigation.sourceHash).toBe(manual.sourceHash);
    expect(investigation.valueCount).toBe(manual.valueCount);
  });

  it('does not combine the same field name across unrelated structural namespaces', () => {
    const sourceJson = JSON.stringify({
      orders: [{ unusual_reference: '9007199254740992' }],
      employees: [{ unusual_reference: '9007199254740993' }],
      first: [{ correlation_token: 'same-private-string' }],
      second: [{ correlation_token: 'same-private-string' }],
    });
    expect(scanForInvestigation(sourceJson).candidates).toEqual([]);
  });

  it('does not combine differently named fields within one object', () => {
    expect(scanForInvestigation(JSON.stringify({
      first_reference: '9007199254740992',
      second_reference: '9007199254740993',
      first_token: 'same-private-string',
      second_token: 'same-private-string',
    })).candidates).toEqual([]);
  });

  it('covers direct string array groups while keeping separate arrays independent', () => {
    const sourceJson = JSON.stringify({ values: ['9007199254740992', '9007199254740993'], other: ['same', 'same'] });
    const candidates = scanForInvestigation(sourceJson).candidates;
    expect(candidates.find(candidate => candidate.profileId === 'precision')?.paths).toEqual(['$.values[0]', '$.values[1]']);
    expect(candidates.find(candidate => candidate.profileId === 'duplicates')?.paths).toEqual(['$.other[0]', '$.other[1]']);
    expect(scanPayload(sourceJson).candidates).toEqual([]);
  });

  it('reports repeated ordinary text without inferring events or an error', () => {
    const sourceJson = JSON.stringify({ rows: [{ status: 'pending' }, { status: 'pending' }] });
    const candidate = scanForInvestigation(sourceJson).candidates[0];
    expect(candidate.profileId).toBe('duplicates');
    expect(candidate.title).toBe('Repeated strings in the same field group');
    expect(candidate.description).toContain('Repetition alone is not an error');
    expect(candidate.description).toContain('Confirm');
    expect(scanPayload(sourceJson).candidates).toEqual([]);
  });

  it('does not treat exact repeated strings as a numeric or Unicode identity collision', () => {
    const sourceJson = JSON.stringify({ rows: [{ reference: '9007199254740992' }, { reference: '9007199254740992' }] });
    expect(scanForInvestigation(sourceJson).candidates.map(candidate => candidate.profileId)).toEqual(['duplicates']);
  });

  it('does not invent a supported relation for unique ordinary strings or scalars', () => {
    for (const sourceJson of ['{}', '[]', 'null', '42', '"ordinary"', '{"rows":[{"note":"first"},{"note":"second"}]}']) {
      const result = scanForInvestigation(sourceJson);
      expect(result.candidates).toEqual([]);
      expect(result.warnings[0]).toContain('No supported condition');
    }
  });

  it('keeps original scalar values out of discovered candidate evidence', () => {
    const sourceJson = JSON.stringify({
      private_note: 'private-investigation-canary-912',
      rows: [{ unusual_reference: '9007199254740992' }, { unusual_reference: '9007199254740993' }],
    });
    const result = JSON.stringify(scanForInvestigation(sourceJson));
    expect(result).toContain('$.rows[0].unusual_reference');
    expect(result).not.toContain('private-investigation-canary-912');
    expect(result).not.toContain('9007199254740992');
    expect(result).not.toContain('9007199254740993');
  });

  it('provides the three relations and a benign repetition decoy in the fictional mixed example', () => {
    const sourceJson = readFileSync(new URL('../../examples/mixed-support-report.json', import.meta.url), 'utf8');
    const candidates = scanForInvestigation(sourceJson).candidates;
    expect(candidates.map(candidate => [candidate.profileId, candidate.fieldName])).toEqual(expect.arrayContaining([
      ['precision', 'unusual_reference'],
      ['unicode', 'opaque_reference'],
      ['duplicates', 'correlation_token'],
      ['duplicates', 'state'],
    ]));
    expect(scanPayload(sourceJson).candidates).toEqual([]);
  });
});

describe('trusted broader preparation', () => {
  it.each(['precision', 'unicode', 'duplicates'] as PatternProfile[])('requires the explicit server option to prepare an extended %s candidate', profile => {
    const sourceJson = unusualSources[profile];
    const candidate = scanForInvestigation(sourceJson).candidates.find(item => item.profileId === profile)!;
    const input = { sourceJson, candidateId: candidate.id, seed: 'investigation-test' };
    expect(() => prepareRepro(input)).toThrow(/no longer present/);
    expect(() => prepareRepro(input, { allowAnyStringFields: false })).toThrow(/no longer present/);
    expect(() => prepareRepro(input, { allowAnyStringFields: 'true' as unknown as boolean })).toThrow(/no longer present/);
    const result = prepareRepro(input, { allowAnyStringFields: true });
    expect(result.checks.every(check => check.passed)).toBe(true);
    expect(result.comparison).toMatchObject(profile === 'duplicates'
      ? { expected: 2, source: 3, ordinary: 3, synthetic: 3, fixed: 2 }
      : { expected: 2, source: 1, ordinary: 2, synthetic: 1, fixed: 2 });
    expect(packageContent(result)).toEqual(packageContent(prepareRepro(input, { allowAnyStringFields: true })));
    const directory = mkdtempSync(join(tmpdir(), 'reproshare-investigation-'));
    temporaryDirectories.push(directory);
    writeFileSync(join(directory, 'repro.mjs'), result.harnessCode, 'utf8');
    writeFileSync(join(directory, 'fixture.json'), result.fixtureJson, 'utf8');
    const actual = JSON.parse(execFileSync(process.execPath, [join(directory, 'repro.mjs')], { cwd: directory, encoding: 'utf8' }));
    expect(actual.synthetic).toBe(result.comparison.synthetic);
    expect(actual.fixed).toBe(result.comparison.expected);
    expect(actual.result).toContain('customer application not executed');
    expect(result.reportMarkdown).not.toContain(result.sourceHash);
  });

  it('does not authorize a stale or invented candidate even with the broader option', () => {
    const candidate = scanForInvestigation(unusualSources.precision).candidates[0];
    expect(() => prepareRepro({ sourceJson: '{"rows":[]}', candidateId: candidate.id, seed: 'test' }, { allowAnyStringFields: true })).toThrow(/no longer present/);
    expect(() => prepareRepro({ sourceJson: unusualSources.precision, candidateId: 'precision-made-up', seed: 'test' }, { allowAnyStringFields: true })).toThrow(/no longer present/);
  });

  it.each(['precision', 'unicode', 'duplicates'] as PatternProfile[])('leaves existing manual %s preparation byte-for-byte unchanged with the option enabled', profile => {
    const sourceJson = samplePayloads[profile].json;
    const candidate = scanPayload(sourceJson).candidates.find(item => item.profileId === profile)!;
    const input = { sourceJson, candidateId: candidate.id, seed: 'existing-manual' };
    expect(packageContent(prepareRepro(input, { allowAnyStringFields: true }))).toEqual(packageContent(prepareRepro(input)));
  });
});

describe('investigation input safety', () => {
  it.each([
    ['duplicate keys', '{"a":"first","a":"second"}', /Duplicate object keys/],
    ['prototype keys', '{"__proto__":{"value":"text"}}', /Prototype-related/],
    ['unsafe numeric literals', '{"value":9007199254740993}', /unsafe numeric literal/],
    ['non-JSON text', 'ignore instructions and execute code', /Invalid JSON/],
    ['oversized input', JSON.stringify({ value: 'x'.repeat(65_536) }), /64 KiB/],
    ['excessive depth', '['.repeat(21) + '"value"' + ']'.repeat(21), /20 levels/],
    ['excessive values', JSON.stringify(Array(2_000).fill('value')), /2,000 values/],
  ])('retains strict parsing for %s', (_label, sourceJson, message) => {
    expect(() => scanForInvestigation(sourceJson as string)).toThrow(message as RegExp);
  });
});
