import type { PreparedRepro } from '../../../src/shared/contracts';

export function evidenceState(repro: PreparedRepro) {
  const report = repro.publicVerification ?? repro.localVerification;
  if (!report) return { title: 'Data condition checked', detail: repro.applicationCase ? 'Application runner ready for local execution' : 'Reference example only; application not executed', level: 'prepared' as const };
  const fixed = report.evidenceLevel === 'fix-validated' || (!report.evidenceLevel && Boolean(report.adapters.fixed));
  return {
    title: fixed ? 'Fix validated locally' : 'Failure reproduced locally',
    detail: fixed ? 'Original and synthetic fail the declared check; checked fix passes' : 'Original and synthetic fail the declared check; fix pending',
    level: fixed ? 'fix-validated' as const : 'failure-reproduced' as const,
  };
}

export function EvidenceStatus({ repro, reviewed = false, published = false }: { repro: PreparedRepro; reviewed?: boolean; published?: boolean }) {
  const status = evidenceState(repro);
  return <div className="evidence-progress" aria-label="Handoff evidence status">
    <span className="evidence-stage-label">{published ? 'Published' : reviewed ? 'Human reviewed' : 'Awaiting human review'}</span>
    <strong>{status.title}</strong>
    <span>{status.detail}</span>
    {status.level !== 'prepared' && <small>Local self-report · execution is not remotely attested</small>}
  </div>;
}
