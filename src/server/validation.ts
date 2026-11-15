import { createHash } from 'node:crypto';
import type { PublishInput, RequiredField } from '../shared/contracts';

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid request. Please reload ReproShare.');
  return value as Record<string, unknown>;
}

export function text(value: unknown, label: string, max = 255): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${label} is missing or too long.`);
  return value;
}

export function jiraId(value: unknown, label = 'Jira identifier'): string {
  const result = text(value, label, 30);
  if (!/^\d+$/.test(result)) throw new Error(`${label} is invalid.`);
  return result;
}

export function reviewId(value: unknown): string {
  const result = text(value, 'Review', 64);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result)) throw new Error('Review is invalid. Prepare a new example.');
  return result;
}

export function issueKey(value: unknown, label = 'Engineering issue key'): string {
  const result = text(value, label, 64);
  if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(result)) throw new Error(`${label} is invalid.`);
  return result;
}

export function actorKey(accountId: string, cloudId: string): string {
  return createHash('sha256').update(JSON.stringify([cloudId, accountId])).digest('hex');
}

export function publicationKey(actor: string, issueId: string, fixtureHash: string, projectId: string): string {
  return `publication-${createHash('sha256').update(JSON.stringify([actor, issueId, fixtureHash, projectId])).digest('hex')}`;
}

export function parsePublish(value: unknown): PublishInput {
  const input = record(value);
  if (input.confirmedReview !== true) throw new Error('Review the complete synthetic example before sharing it.');
  const summary = text(input.summary, 'Summary', 255).trim();
  if (/[\r\n\u0000-\u001f]/.test(summary)) throw new Error('Summary must be a single line.');
  return {
    reviewId: reviewId(input.reviewId),
    projectId: jiraId(input.projectId, 'Destination project'),
    issueTypeId: jiraId(input.issueTypeId, 'Issue type'),
    summary,
    extraFields: input.extraFields === undefined ? {} : record(input.extraFields),
    includeSourceReference: input.includeSourceReference === true,
    confirmedReview: true,
    ...(input.recoverIssueKey === undefined ? {} : { recoverIssueKey: issueKey(input.recoverIssueKey) }),
    ...(input.aiBriefJobId === undefined ? {} : { aiBriefJobId: reviewId(input.aiBriefJobId) }),
  };
}

export function mapRequiredFields(fields: Record<string, unknown>[]): RequiredField[] {
  const standard = new Set(['summary', 'description', 'project', 'issuetype']);
  return fields.filter(f => f.required === true && f.hasDefaultValue !== true && !standard.has(String(f.fieldId ?? f.key))).map(f => {
    const id = String(f.fieldId ?? f.key);
    const schema = (f.schema ?? {}) as Record<string, unknown>;
    const allowed = Array.isArray(f.allowedValues) ? f.allowedValues as Record<string, unknown>[] : [];
    const choices = allowed.filter(v => typeof v.id === 'string').map(v => ({ id: String(v.id), label: String(v.value ?? v.name ?? v.id) }));
    let type: RequiredField['type'] = 'unsupported';
    if (choices.length && (schema.type === 'option' || schema.type === 'priority' || schema.type === 'component' || schema.type === 'version')) type = 'option';
    else if (choices.length && schema.type === 'array') type = 'options';
    else if (schema.type === 'number') type = 'number';
    else if (schema.type === 'date') type = 'date';
    else if (schema.type === 'string' && !String(schema.custom ?? '').includes('textarea')) type = 'string';
    return { id, name: String(f.name ?? id), type, ...(choices.length ? { choices } : {}) };
  });
}

export function validateExtraFields(input: Record<string, unknown>, fields: RequiredField[]): Record<string, unknown> {
  const permitted = new Set(fields.map(f => f.id));
  for (const id of Object.keys(input)) if (!permitted.has(id)) throw new Error('The destination fields changed. Select the issue type again.');
  const output: Record<string, unknown> = {};
  for (const field of fields) {
    const value = input[field.id];
    if (field.type === 'unsupported') throw new Error(`The destination requires ${field.name}, which ReproShare cannot fill. Choose a different issue type or project.`);
    if (field.type === 'string') output[field.id] = text(value, field.name, 4000);
    if (field.type === 'number') {
      if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '' || !Number.isFinite(Number(value))) throw new Error(`${field.name} must be a number.`);
      output[field.id] = Number(value);
    }
    if (field.type === 'date') {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${field.name} needs a valid date.`);
      const parsed = new Date(`${value}T00:00:00Z`);
      if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) throw new Error(`${field.name} needs a valid date.`);
      output[field.id] = value;
    }
    if (field.type === 'option') {
      const id = typeof value === 'object' && value !== null ? (value as Record<string, unknown>).id : value;
      if (!field.choices?.some(c => c.id === id)) throw new Error(`Choose ${field.name}.`);
      output[field.id] = { id };
    }
    if (field.type === 'options') {
      if (!Array.isArray(value) || !value.length) throw new Error(`Choose ${field.name}.`);
      const ids = value.map(v => typeof v === 'object' && v !== null ? (v as Record<string, unknown>).id : v);
      if (ids.some(id => !field.choices?.some(c => c.id === id))) throw new Error(`${field.name} contains an invalid choice.`);
      output[field.id] = ids.map(id => ({ id }));
    }
  }
  return output;
}
