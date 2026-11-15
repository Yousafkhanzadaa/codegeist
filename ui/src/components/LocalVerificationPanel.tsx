import type { PreparedRepro } from '../../../src/shared/contracts';
import { evidenceState } from './EvidenceStatus';
import './EvidenceCards.css';

function save(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function LocalVerificationPanel({ repro, disabled, onImport }: {
  repro: PreparedRepro; disabled: boolean; onImport: (reportJson: string) => Promise<void>;
}) {
  const report = repro.publicVerification ?? repro.localVerification;
  const status = evidenceState(repro);
  const fixed = status.level === 'fix-validated';
  function downloadInputs() {
    save('verification-inputs.json', JSON.stringify({ version: 1, kind: 'reproshare-verification-inputs',
      configurationHash: repro.configurationHash, sourceHash: repro.sourceHash, ordinaryHash: repro.ordinaryHash,
      fixtureHash: repro.fixtureHash, inputContractHash: repro.inputContractHash, inputContract: repro.inputContract,
      ordinaryJson: repro.ordinaryJson, fixtureJson: repro.fixtureJson,
      ...(repro.verificationSpec ? { verificationSpec: repro.verificationSpec } : {}),
      ...(repro.testSpecHash ? { testSpecHash: repro.testSpecHash } : {}),
    }, null, 2));
  }
  function ordinaryLabel() {
    switch (report?.ordinaryControl) {
      case 'preserves-failure': return 'Ordinary replacement also preserved the failure; this run does not establish an advantage over ordinary replacement.';
      case 'different-failure': return 'Ordinary replacement produced a different failure and is shown as a measured control.';
      case 'invalid': return 'The ordinary control could not establish a valid application result.';
      case 'inconclusive': return 'The ordinary control was inconclusive; no claim is made that ordinary replacement hid the bug.';
      default: return 'Ordinary replacement passed and hid the selected failure.';
    }
  }
  return <section className="local-verification" aria-labelledby="local-verification-title">
    <div className="local-verification-heading"><div><span className="eyebrow">APPLICATION EVIDENCE</span><h2 id="local-verification-title">{report ? status.title : 'Prove the application still fails'}</h2></div><span className={`local-evidence-status ${report ? 'local-evidence-complete' : ''}`}>{report ? 'Local self-report' : 'Application not yet run'}</span></div>
    {report ? <>
      <p>The original and synthetic inputs failed the same declared check. {fixed ? 'The checked fixed revision passed the original and synthetic tests.' : 'A fixed revision is not required to hand off this reproduced failure.'}</p>
      <p className="field-help">{ordinaryLabel()}</p>
      <div className="local-matrix-wrap"><table className="local-matrix"><caption className="sr-only">Local application results</caption><thead><tr><th>Input</th><th>Affected code</th><th>{report.adapters.fixed ? 'Checked fixed code' : 'Fix pending'}</th></tr></thead><tbody>{([
        ['Original', 'original', 'fixedOriginal'], ['Ordinary replacement', 'ordinary', 'fixedOrdinary'], ['Synthetic fixture', 'synthetic', 'fixedSynthetic'],
      ] as const).map(([label, affected, fixedName]) => {
        const cell = report.matrix[affected]; const fixedCell = report.matrix[fixedName];
        return <tr key={label}><th scope="row">{label}</th><td>{cell?.outcome === 'fail' ? affected === 'ordinary' && report.ordinaryControl === 'different-failure' ? 'Different failure' : 'Same failure' : cell?.outcome === 'pass' ? 'Pass' : 'Inconclusive'}</td><td>{fixedCell?.outcome === 'pass' ? 'Pass' : fixedCell?.outcome === 'fail' ? 'Failure remains' : fixedCell?.outcome === 'error' ? 'Inconclusive' : 'Not checked'}</td></tr>;
      })}</tbody></table></div>
      <p className="field-help">Self-reported local execution. Forge checked the report and package binding; it did not run or remotely attest to your application. Human review is still required.</p>
      <details className="local-evidence-details"><summary>Assertion and file fingerprints</summary><dl><dt>Assertion</dt><dd><code>{report.assertionId}</code></dd><dt>Failure kind</dt><dd><code>{report.failureKind}</code></dd>{report.failureSite && <><dt>Failure site</dt><dd><code>{report.failureSite}</code></dd></>}{report.testSpecHash && <><dt>Test specification SHA-256</dt><dd><code>{report.testSpecHash}</code></dd></>}<dt>Public receipt SHA-256</dt><dd><code>{repro.publicVerification?.evidenceHash ?? 'Private report only; no public receipt available'}</code></dd></dl>{repro.publicVerification && <button className="text-button" onClick={() => save('execution-receipt.json', JSON.stringify(repro.publicVerification, null, 2))}>Download public execution receipt</button>}</details>
    </> : <>
      <p>Run the original and synthetic inputs in the authorised local application environment. A matching failure is enough to prepare an escalation; checking a fix is optional.</p>
      {repro.inputContract && repro.verificationSpec ? <>
        <div className="local-verification-actions"><button type="button" className="button button-secondary" disabled={disabled} onClick={downloadInputs}>Download check inputs</button><label className={`local-report-upload ${disabled ? 'local-report-disabled' : ''}`}>Import local report<input aria-label="Import local verification report" type="file" accept="application/json,.json" disabled={disabled} onChange={event => {
          const file = event.target.files?.[0]; event.target.value = '';
          if (file) void (file.size > 24 * 1024 ? onImport('') : file.text().then(onImport));
        }} /></label></div>
        <p className="field-help">Check inputs are private, source-side material: they contain source-binding fingerprints. Keep this download and the full local report out of the receiving issue. The reviewed public receipt excludes those bindings.</p>
        <details className="local-evidence-details"><summary>How the local check works</summary><ol><li>The source-authorised escalation engineer keeps the exact original JSON and application code in an approved local or CI environment.</li><li>Connect the application's named assertion and pinned affected-code adapter. Add a fixed adapter later when a fix exists.</li><li>Run the ReproShare CLI with the downloaded check inputs, original file and local adapter.</li><li>Import its verified report here. Inspect the new public evidence and approve the handoff again.</li></ol><pre><code>node scripts/reproshare-check.mjs --package verification-inputs.json --source source.json --oracle oracle.json --cwd . --allow-command --out local-report.json</code></pre><p className="field-help">Commands run only after explicit local authorisation. Original input and local commands are excluded from the shared package. Assertion names, declared paths and retained public requirements still need review.</p></details>
      </> : <p className="field-help">{repro.inputContract ? 'Input requirements are declared, but no application test is bound to this reference example.' : 'Declare application input requirements and a test before importing execution evidence.'} Connect a local service profile and import its source-side review package from Source. You can still share this clearly labelled reference example after human review.</p>}
    </>}
  </section>;
}
