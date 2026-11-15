import { describe, expect, it } from 'vitest';
import { actorKey, jiraId, mapRequiredFields, parsePublish, publicationKey, reviewId, validateExtraFields } from '../../src/server/validation';
import type { RequiredField } from '../../src/shared/contracts';

const valid = { reviewId: 'b35939e6-1c29-4d81-9b18-6d727fe5c904', projectId: '200', issueTypeId: '300', summary: 'Synthetic example', confirmedReview: true };

describe('untrusted publishing inputs', () => {
  it('requires an actual review confirmation and a version-four review identifier', () => {
    for (const confirmedReview of [undefined, false, 'true', 1]) expect(() => parsePublish({ ...valid, confirmedReview })).toThrow('Review the complete');
    for (const id of ['../review', 'b35939e6-1c29-1d81-9b18-6d727fe5c904', '']) expect(() => reviewId(id)).toThrow();
  });

  it('uses strict opt-in for including a source reference and discards client artifact fields', () => {
    for (const value of [undefined, false, 'true', 1, {}]) {
      const input = parsePublish({ ...valid, includeSourceReference: value, fixtureJson: 'PRIVATE', actor: 'another-user' });
      expect(input.includeSourceReference).toBe(false);
      expect(input).not.toHaveProperty('fixtureJson');
      expect(input).not.toHaveProperty('actor');
    }
    expect(parsePublish({ ...valid, includeSourceReference: true }).includeSourceReference).toBe(true);
  });

  it('rejects path-like identifiers, multiline summaries, and array-shaped fields', () => {
    for (const id of ['200/issue', '200?admin=true', '-1', 200, '1'.repeat(31)]) expect(() => jiraId(id)).toThrow();
    for (const summary of ['a\nb', 'a\rb', 'a\u0000b', 'a'.repeat(256)]) expect(() => parsePublish({ ...valid, summary })).toThrow();
    expect(() => parsePublish({ ...valid, extraFields: [] })).toThrow();
  });

  it('accepts an optional version-four AI briefing job identifier and discards all client AI content', () => {
    const aiBriefJobId = 'd35939e6-1c29-4d81-9b18-6d727fe5c904';
    const parsed = parsePublish({ ...valid, aiBriefJobId, aiBrief: { summary: 'PRIVATE' }, investigation: { explanation: 'PRIVATE' }, aiInvestigation: { title: 'PRIVATE' }, model: 'client-choice', consentToAi: true });
    expect(parsed.aiBriefJobId).toBe(aiBriefJobId);
    for (const field of ['aiBrief', 'investigation', 'aiInvestigation', 'model', 'consentToAi']) expect(parsed).not.toHaveProperty(field);
    expect(parsePublish(valid)).not.toHaveProperty('aiBriefJobId');
  });

  it.each([null, '', ' ', '../job', 'd35939e6-1c29-1d81-9b18-6d727fe5c904', 'd35939e6-1c29-4d81-0b18-6d727fe5c904', 123, {}, []])('rejects a malformed optional AI job identifier: %j', aiBriefJobId => {
    expect(() => parsePublish({ ...valid, aiBriefJobId })).toThrow();
  });

  it('separates account and site identity without delimiter collisions', () => {
    expect(actorKey('user', 'site-a')).not.toBe(actorKey('user', 'site-b'));
    expect(actorKey('a,b', 'c')).not.toBe(actorKey('a', 'b,c'));
    const args = ['actor', '100', 'fixture', '200'] as const;
    expect(publicationKey(...args)).not.toBe(publicationKey('other-actor', '100', 'fixture', '200'));
    expect(publicationKey(...args)).not.toBe(publicationKey('actor', '101', 'fixture', '200'));
    expect(publicationKey(...args)).not.toBe(publicationKey('actor', '100', 'other-fixture', '200'));
    expect(publicationKey(...args)).not.toBe(publicationKey('actor', '100', 'fixture', '201'));
  });
});

describe('destination field allowlist', () => {
  it('excludes built-in fields and fields with defaults, but rejects unsupported required schemas', () => {
    const fields = mapRequiredFields([
      { fieldId: 'summary', required: true, schema: { type: 'string' } },
      { fieldId: 'priority', required: true, hasDefaultValue: true, schema: { type: 'priority' } },
      { fieldId: 'optional', required: false, schema: { type: 'string' } },
      { fieldId: 'assignee', name: 'Assignee', required: true, schema: { type: 'user' } },
    ]);
    expect(fields).toEqual([{ id: 'assignee', name: 'Assignee', type: 'unsupported' }]);
    expect(() => validateExtraFields({ assignee: { accountId: 'other' } }, fields)).toThrow('cannot fill');
  });

  it('rejects attempts to overwrite project, type, description, security, or reporter', () => {
    for (const id of ['project', 'issuetype', 'description', 'security', 'reporter', '__proto__']) {
      const input = Object.fromEntries([[id, { id: 'attacker-choice' }]]);
      expect(() => validateExtraFields(input, [])).toThrow('destination fields changed');
    }
  });

  it('normalizes only server-advertised choices and discards extra option object attributes', () => {
    const fields: RequiredField[] = [
      { id: 'customfield_1', name: 'Choice', type: 'option', choices: [{ id: '10', label: 'Allowed' }] },
      { id: 'components', name: 'Components', type: 'options', choices: [{ id: '20', label: 'Component' }] },
    ];
    expect(validateExtraFields({ customfield_1: { id: '10', name: 'injected' }, components: ['20'] }, fields)).toEqual({ customfield_1: { id: '10' }, components: [{ id: '20' }] });
    expect(() => validateExtraFields({ customfield_1: '99', components: ['20'] }, fields)).toThrow('Choose Choice');
    expect(() => validateExtraFields({ customfield_1: '10', components: ['99'] }, fields)).toThrow('invalid choice');
  });

  it('requires finite numeric values and nonempty required strings', () => {
    const number: RequiredField[] = [{ id: 'customfield_n', name: 'Estimate', type: 'number' }];
    for (const value of [undefined, '', ' ', Infinity, 'Infinity', NaN, {}, []]) expect(() => validateExtraFields({ customfield_n: value }, number)).toThrow();
    expect(validateExtraFields({ customfield_n: '12.5' }, number)).toEqual({ customfield_n: 12.5 });
    expect(() => validateExtraFields({ customfield_s: ' ' }, [{ id: 'customfield_s', name: 'Reason', type: 'string' }])).toThrow();
  });

  it('rejects impossible calendar dates rather than normalizing them into another month', () => {
    const fields: RequiredField[] = [{ id: 'duedate', name: 'Due date', type: 'date' }];
    expect(validateExtraFields({ duedate: '2028-02-29' }, fields)).toEqual({ duedate: '2028-02-29' });
    for (const value of ['2026-02-29', '2026-02-31', '2026-04-31', '2026-13-01', 'tomorrow']) expect(() => validateExtraFields({ duedate: value }, fields)).toThrow('valid date');
  });
});
