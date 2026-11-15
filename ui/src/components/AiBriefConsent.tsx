import { useMemo } from 'react';
import type { PreparedRepro } from '../../../src/shared/contracts';
import { applicationBriefContext } from '../../../src/shared/ai-context';

export function AiBriefConsent({ repro, checked, disabled, onChange }: { repro: PreparedRepro; checked: boolean; disabled: boolean; onChange: (checked: boolean) => void }) {
  const application = repro.profileId === 'application';
  const metadata = useMemo(() => {
    if (!application) return null;
    try { return { title: repro.title, profileId: repro.profileId, checks: repro.checks, publicApplicationTest: applicationBriefContext(repro) }; }
    catch { return null; }
  }, [application, repro]);
  return <>
    <label className="checkbox-row ai-consent"><input type="checkbox" checked={checked} disabled={disabled || application && !metadata} onChange={event => onChange(event.target.checked)} /><span><strong>{application ? 'Send the reviewed application metadata below to Atlassian-hosted Claude.' : 'Send this synthetic fixture and verification results to Atlassian-hosted Claude.'}</strong><small>{application ? 'Original input, synthetic scalar values, private fingerprints, commands and application code are excluded. Review schema keys, public constants, title and test labels: they can still reveal context.' : 'Original source values and the earlier free-text report are excluded. Retained field names and structure are included.'}</small></span></label>
    {application && <details className="ai-metadata-preview"><summary>Preview application data sent to AI</summary>{metadata ? <><p>The server sends this metadata with instructions to select up to three listed next checks. The factual summary is computed from the report. Selected checks are unexecuted proposals.</p><pre><code>{JSON.stringify(metadata, null, 2)}</code></pre></> : <p>Import a valid application report before requesting a brief.</p>}</details>}
  </>;
}
