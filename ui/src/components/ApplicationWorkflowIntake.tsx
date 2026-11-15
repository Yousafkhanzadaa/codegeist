import './EvidenceCards.css';

export function ApplicationWorkflowIntake({ disabled, onImport }: { disabled: boolean; onImport: (packageJson: string) => Promise<void> }) {
  return <section className="workflow-intake" aria-labelledby="workflow-intake-title">
    <div className="workflow-intake-heading"><div><span className="eyebrow">YOUR APPLICATION</span><h2 id="workflow-intake-title">Connect a test once. Reuse it for new reports.</h2></div><span>Local execution</span></div>
    <p>An escalation engineer runs the original in an approved environment with customer-data and application-code access. Engineering receives a reviewed changed-value test and approved pinned code. A fix can be checked later.</p>
    <label className={`local-report-upload ${disabled ? 'local-report-disabled' : ''}`}>Import application review package<input aria-label="Import application handoff package" type="file" accept="application/json,.json" disabled={disabled} onChange={event => {
      const file = event.target.files?.[0]; event.target.value = '';
      if (file) void (file.size > 256 * 1024 ? onImport('') : file.text().then(onImport));
    }} /></label>
    <p className="field-help">Choose the source-side workflow-review.json exported after local code review. It includes private report bindings and belongs in this authorised source view. Keep it, the original and local-result.json out of the receiving issue. Importing never publishes it; approval is required here.</p>
    <details className="local-evidence-details"><summary>Set up and reuse a local application profile</summary><ol><li>A developer connects an existing meaningful assertion and pins its application adapter. Import a supported public schema; keep private constants out of it.</li><li>The source-authorised operator uses that profile on each new report. Bounded search and minimisation run against the actual test locally.</li><li>Inspect the transformed fixture, retained information and every exported application/test file for private literals or credentials. Export only after reviewing them.</li><li>Import the source-side review package here, review it again and choose a destination authorised to receive the embedded code. Recipients do not need the original customer report.</li></ol><p className="field-help">The local workflow does not upload the original or run arbitrary application code in Forge. Command execution requires explicit local authorisation. Schema support and search are bounded; some bugs must be refused.</p></details>
  </section>;
}
