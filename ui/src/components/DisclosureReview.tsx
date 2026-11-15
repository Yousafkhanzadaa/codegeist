import { useMemo, useState } from 'react';
import type { PreparedRepro } from '../../../src/shared/contracts';
import type { InputSchema } from '../../../src/domain/input-contract';
import './EvidenceCards.css';

type Scalar = string | number | boolean | null;
type Row = { path: string; key: string; value: Scalar; original?: Scalar; hasOriginal: boolean; publicConstant: boolean; boolean: boolean };
const sensitiveKey = /(?:email|phone|address|customer|secret|password|token|ssn|credential)/i;

function inspect(sourceJson: string, repro: PreparedRepro): Row[] {
  let source: unknown;
  try { source = sourceJson && sourceJson.length <= 65_536 ? JSON.parse(sourceJson) : undefined; } catch { source = undefined; }
  let fixture: unknown;
  try { fixture = JSON.parse(repro.fixtureJson); } catch { return []; }
  const rows: Row[] = [];
  function visit(value: unknown, original: unknown, schema: InputSchema | undefined, path: string, key: string, depth: number) {
    if (depth > 20 || rows.length >= 2_000) return;
    if (Array.isArray(value)) {
      value.forEach((child, index) => visit(child, Array.isArray(original) ? original[index] : undefined, schema?.type === 'array' ? schema.items : undefined, `${path}[${index}]`, key, depth + 1));
    } else if (value !== null && typeof value === 'object') {
      for (const [name, child] of Object.entries(value)) visit(child, original !== null && typeof original === 'object' && Object.hasOwn(original, name) ? (original as Record<string, unknown>)[name] : undefined,
        schema?.type === 'object' ? schema.properties[name] : undefined, `${path}[${JSON.stringify(name)}]`, name, depth + 1);
    } else if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
      const publicConstant = Boolean(schema && 'public' in schema && schema.public === true && 'enum' in schema && schema.enum?.some(item => Object.is(item, value)));
      rows.push({ path, key, value: value as Scalar, ...(original !== undefined ? { original: original as Scalar } : {}), hasOriginal: original !== undefined, publicConstant, boolean: typeof value === 'boolean' });
    }
  }
  visit(fixture, source, repro.inputContract?.schema, '$', '(root)', 0);
  return rows;
}

export function DisclosureReview({ sourceJson, repro }: { sourceJson: string; repro: PreparedRepro }) {
  const [filter, setFilter] = useState('');
  const [onlyRetained, setOnlyRetained] = useState(false);
  const [revealOriginals, setRevealOriginals] = useState(false);
  const rows = useMemo(() => inspect(sourceJson, repro), [sourceJson, repro]);
  const publicRows = rows.filter(row => row.publicConstant);
  const booleanRows = rows.filter(row => row.boolean);
  const keyFindings = [...new Set(rows.filter(row => sensitiveKey.test(row.key)).map(row => row.key))];
  const retained = (row: Row) => row.publicConstant || row.value === null || row.boolean || row.hasOriginal && Object.is(row.original, row.value);
  const visible = rows.filter(row => (!onlyRetained || retained(row)) && `${row.path} ${row.publicConstant ? 'public constant' : ''} ${row.boolean ? 'boolean' : ''}`.toLowerCase().includes(filter.toLowerCase()));
  const hasSource = rows.some(row => row.hasOriginal);
  return <section className="disclosure-review" aria-labelledby="disclosure-title">
    <div className="disclosure-heading"><div><span className="eyebrow">PRIVATE REVIEW</span><h2 id="disclosure-title">What will leave this issue?</h2></div><span>Review before approval</span></div>
    <p>Inspect changed values and retained information privately. Originals start masked; this comparison adds nothing to shared files or AI requests.</p>
    <div className="disclosure-facts"><div><strong>{publicRows.length}</strong><span>declared public {publicRows.length === 1 ? 'constant' : 'constants'}</span></div><div><strong>{booleanRows.length}</strong><span>Boolean {booleanRows.length === 1 ? 'value' : 'values'}</span></div><div><strong>{keyFindings.length}</strong><span>field names to inspect</span></div></div>
    <div className="disclosure-retained"><strong>Information still visible</strong><p>Field names, structure, lengths and selected relationships may reveal context.{rows.some(row => row.value === null) && ' Null markers remain visible.'}{booleanRows.length > 0 && ' A disclosed Boolean inversion reveals the original bit.'}</p>{publicRows.length > 0 && <p>Declared public constants may remain unchanged. Inspect their actual values below.</p>}{keyFindings.length > 0 && <p>Inspect these field names: {keyFindings.map((key, index) => <span key={key}>{index > 0 && ', '}<code>{key}</code></span>)}. This name-based hint does not detect all sensitive information.</p>}</div>
    {!hasSource && <p className="field-help">Original values are unavailable here. Review the source-side comparison in the authorised local environment before approving this imported package.</p>}
    <details className="disclosure-fields"><summary>Inspect fields and private comparison</summary>
    <div className="disclosure-tools"><div className="field"><label htmlFor="disclosure-filter">Find a field or retained constant</label><input id="disclosure-filter" value={filter} onChange={event => setFilter(event.target.value)} placeholder="For example, customerEmail" /></div><label className="checkbox-row"><input type="checkbox" checked={onlyRetained} onChange={event => setOnlyRetained(event.target.checked)} /><span>Show retained or reversible information only</span></label></div>
    {hasSource && <label className="checkbox-row disclosure-reveal"><input type="checkbox" checked={revealOriginals} onChange={event => setRevealOriginals(event.target.checked)} /><span><strong>Show original values privately in this view</strong><small>Use only when your screen and surroundings are appropriate for the source data.</small></span></label>}
    <div className="disclosure-table-wrap" tabIndex={0} aria-label="Disclosure fields"><table className="disclosure-table"><caption>{visible.length} of {rows.length} fields shown</caption><thead><tr><th scope="col">Field</th><th scope="col">Original</th><th scope="col">Shared value</th><th scope="col">Review</th></tr></thead><tbody>{visible.map(row => <tr key={row.path}><th scope="row"><code>{row.path}</code></th><td>{revealOriginals && row.hasOriginal ? <code>{JSON.stringify(row.original)}</code> : <span className="masked-value">{row.hasOriginal ? 'Masked' : 'Not included'}</span>}</td><td><code>{JSON.stringify(row.value)}</code></td><td>{row.publicConstant ? 'Public constant' : row.boolean ? 'Reversible Boolean' : row.value === null ? 'Retained null' : row.hasOriginal && Object.is(row.original, row.value) ? 'Unchanged: inspect' : row.hasOriginal ? 'Changed value' : 'Review locally'}</td></tr>)}</tbody></table>{!visible.length && <p className="field-help">No fields match this filter.</p>}</div></details>
  </section>;
}
