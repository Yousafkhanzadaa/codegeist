import type { AiBrief, AiInvestigation } from '../../../src/shared/contracts';
import './EvidenceCards.css';

const outcomeLabels: Record<AiInvestigation['outcome'], string> = {
  recommended: 'A condition to investigate',
  relevance_unconfirmed: 'Relevance to the report is unconfirmed',
  needs_clarification: 'More context is needed',
  unsupported: 'Outside current verification coverage',
};

export function AiPlanCard({ investigation, onChooseCandidate, selectedCandidateId, disabled }: {
  investigation: AiInvestigation;
  onChooseCandidate: (id: string) => void;
  selectedCandidateId: string;
  disabled?: boolean;
}) {
  const canSuggest = investigation.outcome === 'recommended' || investigation.outcome === 'relevance_unconfirmed';
  const suggested = canSuggest ? investigation.candidates.find(candidate => candidate.id === investigation.recommendedCandidateId) : undefined;
  return <section className={`ai-plan ai-result ai-outcome-${investigation.outcome}`} aria-labelledby="ai-plan-title">
    <div className="ai-result-header"><span className="ai-result-label"><span className="ai-result-symbol" aria-hidden="true">✦</span> AI investigation</span><span className="ai-result-model"><span>Model</span> {investigation.model}</span></div>
    <span className="ai-result-status">{outcomeLabels[investigation.outcome]}</span>
    <h2 id="ai-plan-title">{investigation.title}</h2><p className="ai-result-explanation">{investigation.explanation}</p>
    <div className="ai-result-assumption"><span className="ai-result-section-label">Assumption to confirm</span><p>{investigation.assumption}</p></div>
    {suggested && <div className="ai-result-recommendation"><span className="ai-result-section-label">Proposed check</span><h3>{suggested.title}</h3><div className="ai-result-paths">{suggested.paths.map(path => <code key={path}>{path}</code>)}</div><button type="button" className="button button-secondary" disabled={disabled || selectedCandidateId === suggested.id} onClick={() => onChooseCandidate(suggested.id)}>{selectedCandidateId === suggested.id ? 'Suggested condition selected' : 'Use suggested condition'}</button></div>}
    {!!investigation.questions.length && <div className="ai-result-questions"><h3>Questions before drawing a conclusion</h3><ul>{investigation.questions.map((question, index) => <li key={index}>{question}</li>)}</ul></div>}
    {!!investigation.nextSteps.length && <details className="ai-result-next-steps"><summary>Suggested investigation steps</summary><ol>{investigation.nextSteps.map((step, index) => <li key={index}>{step}</li>)}</ol></details>}
    <p className="ai-result-boundary">AI proposes a direction. A passing data check does not establish the cause of the reported application failure.</p>
  </section>;
}

export function AiBriefCard({ brief, included, onIncludeChange, disabled }: {
  brief: AiBrief;
  included: boolean;
  onIncludeChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return <section className={`ai-brief-card ai-brief-result ${included ? 'ai-brief-result-included' : ''}`} aria-labelledby="ai-brief-title">
    <div className="ai-result-header"><span className="ai-result-label"><span className="ai-result-symbol" aria-hidden="true">✦</span> {brief.planningMode === 'schema-selection' ? 'AI-prioritised test plan' : 'AI engineering brief'}</span><span className="ai-result-model"><span>Model</span> {brief.model}</span></div>
    <div className="ai-brief-title-row"><h3 id="ai-brief-title">{brief.title}</h3><span className="ai-brief-selection-state">{included ? 'Included in handoff' : 'Draft · not included'}</span></div><p className="ai-brief-summary">{brief.summary}</p>
    {brief.planningMode === 'schema-selection' && <p className="ai-brief-review-note">The measured summary comes from the report. AI selected priorities from the displayed schema-based test options; those proposals have not been executed.</p>}
    <div className="ai-brief-outline">
      <section className="ai-brief-outline-section"><div className="ai-brief-section-heading"><span aria-hidden="true">01</span><h4>Steps using this synthetic example</h4></div><ol>{brief.reproductionSteps.map((step, index) => <li key={index}>{step}</li>)}</ol></section>
      <section className="ai-brief-outline-section"><div className="ai-brief-section-heading"><span aria-hidden="true">02</span><h4>Hypotheses to investigate</h4></div><ul>{brief.investigationAreas.map((area, index) => <li key={index}>{area}</li>)}</ul></section>
      <section className="ai-brief-outline-section"><div className="ai-brief-section-heading"><span aria-hidden="true">03</span><h4>Proposed acceptance criteria</h4></div><ul>{brief.acceptanceCriteria.map((criterion, index) => <li key={index}>{criterion}</li>)}</ul></section>
    </div>
    <p className="ai-brief-review-note">{brief.caution}</p>
    <label className="checkbox-row ai-brief-approval"><input type="checkbox" checked={included} disabled={disabled} onChange={event => onIncludeChange(event.target.checked)} /><span><strong>Include this reviewed AI brief in handoff</strong><small>I reviewed its claims and content. It is a proposal based on the synthetic example, not a verified diagnosis or production fix.</small></span></label>
  </section>;
}
