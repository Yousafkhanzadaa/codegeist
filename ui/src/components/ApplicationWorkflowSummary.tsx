import type { PreparedRepro } from '../../../src/shared/contracts';

export function ApplicationWorkflowSummary({ repro }: { repro: PreparedRepro }) {
  const summary = repro.workflowSummary;
  const rows = [
    ['Candidates tried', summary?.attempts], ['Application runs', summary?.runs],
    ['Parts removed', summary?.removedParts], ['Shared fixture bytes', summary?.fixtureBytes],
  ] as const;
  return <section className="application-workflow-summary" aria-labelledby="application-workflow-title">
    <h2 id="application-workflow-title">Run the actual received application test</h2>
    <p>The reviewed adapter and pinned application files are embedded in this runner. The original customer input is excluded. Confirm that the destination can receive this code, and review it before explicitly allowing local execution.</p>
    <pre><code>node application-reproducer.mjs --allow-command fixture.json</code></pre>
    <p className="field-help">Node.js 24+ is required; Python adapters also require Python 3.11+. Keep both downloads in the same folder. The result checks the synthetic input; it cannot independently rerun the withheld original.</p>
    {summary && <details className="local-evidence-details"><summary>Bounded local search and minimisation</summary><dl><dt>Service profile</dt><dd><code>{summary.profileId}</code></dd>{rows.filter(([, value]) => typeof value === 'number').map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{String(value)}</dd></div>)}</dl><p className="field-help">These are the source operator's reported local search counts. A bounded reduction does not establish a globally minimal example or an anonymity guarantee.</p></details>}
  </section>;
}
