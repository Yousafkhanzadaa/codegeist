import { useEffect, useState } from 'react';
import type { RecentReview } from '../../../src/shared/contracts';
import { api } from '../api';

const levels: Record<RecentReview['evidenceLevel'], string> = { prepared: 'Data condition checked', 'failure-reproduced': 'Failure reproduced locally', 'fix-validated': 'Fix validated locally' };

export function RecentReviews({ issueId, disabled, onResume }: { issueId: string; disabled: boolean; onResume: (reviewId: string, renewExpired: boolean) => Promise<void> }) {
  const [rows, setRows] = useState<RecentReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [renewId, setRenewId] = useState('');
  async function refresh() {
    setLoading(true); setError('');
    try { setRows(await api.getRecentReviews()); }
    catch { setError('Recent reviews could not be loaded. You can still prepare a new package.'); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    let active = true;
    setLoading(true); setRows([]); setError('');
    void api.getRecentReviews().then(data => { if (active) setRows(data); }).catch(() => { if (active) setError('Recent reviews could not be loaded. You can still prepare a new package.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [issueId]);
  return <details className="recent-reviews"><summary>Recent reviews for this source issue <span>{loading ? 'Loading…' : rows.length}</span></summary>
    <p>Resume a package prepared by your account in the last 24 hours. This creates a new review and clears approvals. It does not re-run the application or strengthen the previous execution evidence.</p>
    {error && <p className="field-help" role="status">{error}</p>}
    {!loading && !error && !rows.length && <p className="field-help">No recent reviews for your account on this issue.</p>}
    <ol>{rows.map(row => <li key={row.reviewId}><div className="recent-review-heading"><div><strong>{row.title}</strong><span>{levels[row.evidenceLevel]} · {new Date(row.createdAt).toLocaleString()}</span><code>Fixture {row.fixtureHash.slice(0, 12)}…</code></div><button className="button button-secondary" disabled={disabled || loading || row.stale || row.expired && renewId !== row.reviewId} aria-label={`Resume review ${row.title}`} onClick={() => void onResume(row.reviewId, row.expired)}>Resume review</button></div>{row.stale ? <p className="field-help">The source issue changed. Prepare or import a current package instead.</p> : row.expired ? <label className="checkbox-row"><input type="checkbox" checked={renewId === row.reviewId} disabled={disabled} onChange={event => setRenewId(event.target.checked ? row.reviewId : '')} /><span>I will review this expired package again. Resuming does not run its application test.</span></label> : null}</li>)}</ol>
    <button className="text-button" disabled={disabled || loading} onClick={() => void refresh()}>Refresh recent reviews</button>
  </details>;
}
