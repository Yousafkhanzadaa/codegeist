import type { ApplicationCase, PreparedRepro } from '../../../src/shared/contracts';
import { evidenceState } from './EvidenceStatus';
import './EvidenceCards.css';

export function ApplicationCaseCard({ applicationCase, repro, onOpenLink }: {
  applicationCase: ApplicationCase;
  repro: PreparedRepro;
  onOpenLink: (url: string) => void;
}) {
  const hermes = applicationCase.id === 'hermes-integer-coercion';
  const status = evidenceState(repro);
  const reported = status.level !== 'prepared';
  return <section className="application-case-card application-proof" aria-labelledby="application-case-review-title">
    <div className="proof-header">
      <span className="proof-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="3" /><path d="m7 9 3 3-3 3m6 0h4" /></svg></span>
      <div><span className="proof-kicker">Application check</span><h2 id="application-case-review-title">{applicationCase.title}</h2></div>
      <span className="proof-status">{reported ? status.title : 'Runner ready'}</span>
    </div>
    <p className="proof-next-step">{reported ? status.detail : 'Runner ready—run application check locally'}</p>
    <p className="proof-explanation">{reported ? 'A local application report is attached to this package. ' : 'The reference checks are complete. '}<strong>Forge has not executed {hermes ? 'Hermes' : 'es-toolkit'}.</strong> {reported ? 'Use the downloaded runner to inspect or repeat the pinned public application comparison.' : 'Run the downloaded package to compare the unchanged affected and fixed code.'}</p>
    <div className="proof-entrypoint"><span>Entrypoint</span><code>{applicationCase.entrypoint}</code></div>
    <div className="proof-command"><div><span>{reported ? 'Re-run the public application comparison' : 'Run locally'}</span><span>{hermes ? 'Node.js 22+ · Python 3.11+' : 'Node.js 24.22+'}</span></div><code>node repro.mjs fixture.json</code><p>Save both downloaded files in the same folder; no network or API key is required.</p></div>
    <div className="proof-links"><button className="text-button" type="button" onClick={() => onOpenLink(applicationCase.issueUrl)}>Read upstream issue <span aria-hidden="true">↗</span></button><button className="text-button" type="button" onClick={() => onOpenLink(applicationCase.fixUrl)}>Read {hermes ? 'proposed' : 'merged'} fix <span aria-hidden="true">↗</span></button></div>
    <details className="proof-details"><summary>Application details and provenance</summary><div className="proof-details-content">
      <dl className="proof-metadata"><div><dt>Affected revision</dt><dd><code>{applicationCase.affectedRevision}</code></dd></div><div><dt>{hermes ? 'Proposed fix' : 'Merged fix'} revision</dt><dd><code>{applicationCase.proposedFixRevision}</code>{hermes && <span className="proof-proposal-note">Open proposal at case capture; merge or release is not established by this runner.</span>}</dd></div><div><dt>Valid input contract</dt><dd>{applicationCase.inputContract}</dd></div></dl>
      <h3>Runner requirements</h3><ul>{applicationCase.requirements.map((requirement, index) => <li key={index}>{requirement}</li>)}</ul><p>The runner embeds hashed, unchanged upstream source and its license. It uses only the listed local runtimes and standard libraries.</p>
      <h3>Execution scope</h3><p>{applicationCase.scope}</p>
    </div></details>
  </section>;
}
