import { useMemo, useState } from 'react';
import type { InputSchema } from '../../../src/domain/input-contract';
import './EvidenceCards.css';

function draftSchema(value: unknown, depth = 0, counter = { nodes: 0 }): InputSchema {
  if (depth > 10 || ++counter.nodes > 100) throw new Error('This structure needs a developer-reviewed schema. Import a supported schema with the local service-profile setup.');
  if (value === null) return { type: 'null' };
  if (Array.isArray(value)) {
    if (!value.length) throw new Error('An empty array does not establish its item type. Declare its item requirements in the advanced contract.');
    const schemas = value.map(child => draftSchema(child, depth + 1, counter));
    if (schemas.some(schema => JSON.stringify(schema) !== JSON.stringify(schemas[0]))) throw new Error('Mixed array shapes need a developer-reviewed schema. No draft was applied.');
    return { type: 'array', minItems: 0, maxItems: 2_000, items: schemas[0] };
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length > 64 || entries.some(([key]) => ['__proto__', 'prototype', 'constructor'].includes(key))) throw new Error('This object cannot be drafted safely. Use a developer-reviewed contract.');
    return { type: 'object', additionalProperties: false, required: entries.map(([key]) => key), properties: Object.fromEntries(entries.map(([key, child]) => [key, draftSchema(child, depth + 1, counter)])) };
  }
  if (typeof value === 'string') return { type: 'string', maxLength: 4_096 };
  if (typeof value === 'number') return { type: 'number' };
  if (typeof value === 'boolean') return { type: 'boolean' };
  throw new Error('Only bounded JSON structures can be drafted.');
}

function summary(contractJson: string): Array<{ path: string; detail: string }> {
  if (contractJson.length > 32_768) return [];
  try {
    const contract = JSON.parse(contractJson); const fields: Array<{ path: string; detail: string }> = [];
    function visit(schema: InputSchema, path: string, depth: number) {
      if (!schema || depth > 12 || fields.length >= 128) return;
      if (schema.type === 'object') for (const [name, child] of Object.entries(schema.properties ?? {})) visit(child, `${path}/${name}`, depth + 1);
      else if (schema.type === 'array') visit(schema.items, `${path}/*`, depth + 1);
      else fields.push({ path: path || '/', detail: `${schema.type}${'format' in schema && schema.format ? ` · ${schema.format}` : ''}${'enum' in schema && schema.enum ? ' · public constants retained' : ''}${'minLength' in schema && schema.minLength !== undefined ? ` · at least ${schema.minLength} characters` : ''}${'maxLength' in schema && schema.maxLength !== undefined ? ` · at most ${schema.maxLength} characters` : ''}` });
    }
    visit(contract.schema, '', 0); return fields;
  } catch { return []; }
}

export function InputRequirementsPanel({ value, sourceJson, disabled, onChange }: { value: string; sourceJson: string; disabled: boolean; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const fields = useMemo(() => summary(value), [value]);
  function propose() {
    setError(''); setDraft('');
    try {
      if (sourceJson.length > 65_536) throw new Error('Use an input of at most 64 KiB for structural drafting.');
      setDraft(JSON.stringify({ version: 1, schema: draftSchema(JSON.parse(sourceJson)) }, null, 2));
    } catch (err) { setError(err instanceof Error && err.name !== 'SyntaxError' ? err.message : 'Use valid JSON before drafting requirements.'); }
  }
  return <details className="input-requirements"><summary>Input requirements <span>{value.trim() ? 'Declared' : 'Set up application validity'}</span></summary>
    <p>Declare what makes an input valid before checking its failure. Formats, ID ranges, public constants and field relationships must match your application. These requirements are public in the handoff.</p>
    {fields.length > 0 && <ul className="requirements-summary" aria-label="Declared input fields">{fields.map((field, index) => <li key={`${field.path}-${index}`}><code>{field.path}</code><span>{field.detail}</span></li>)}</ul>}
    <button type="button" className="button button-secondary" disabled={disabled || !sourceJson.trim()} onClick={propose}>Draft requirements from structure</button>
    <p className="field-help">Drafting stays in this view. It copies field names and types, never original values or enum literals. It cannot infer the application's business rules.</p>
    {error && <p className="field-error" role="alert">{error}</p>}
    {draft && <div className="requirements-draft"><strong>Review the proposed structure</strong><p>Every observed object field is required; arrays allow 0–2,000 items. Add real formats, ranges and relationships in the editor before using it. No application validity has been established by this draft.</p><pre><code>{draft}</code></pre><button type="button" className="button button-secondary" disabled={disabled} onClick={() => { onChange(draft); setDraft(''); }}>Use this draft for editing</button></div>}
    <details className="requirements-editor" open={Boolean(value.trim())}><summary>Edit the bounded public contract</summary><label htmlFor="input-contract">Public input contract</label><textarea id="input-contract" spellCheck={false} value={value} disabled={disabled} placeholder={'{ "version": 1, "schema": { "type": "object", "additionalProperties": false, "properties": {} } }'} onChange={event => onChange(event.target.value)} /><p className="field-help">This is a bounded schema, not full JSON Schema. Declare every field. Enum literals require <code>public: true</code> and may remain in the output. Private values do not belong here. Existing OpenAPI/JSON Schema can be imported through local service-profile setup; unsupported keywords are refused.</p></details>
  </details>;
}
