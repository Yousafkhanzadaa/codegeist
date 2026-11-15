import type { AiBrief, PreparedRepro } from '../shared/contracts';

type Node = { type: string; attrs?: Record<string, unknown>; content?: Node[]; text?: string; marks?: Array<{ type: string; attrs?: Record<string, unknown> }> };
const paragraph = (value: string): Node => ({ type: 'paragraph', content: [{ type: 'text', text: value }] });

export function reproDescription(repro: PreparedRepro, files: { fixture: string; harness: string }, sourceKey?: string, publicationReference?: string, aiBrief?: AiBrief) {
  const applicationCase = repro.applicationCase;
  const execution = repro.publicVerification;
  const applicationWorkflow = repro.profileId === 'application';
  const content: Node[] = [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: execution ? 'Application failure reproduced locally' : applicationCase ? 'Synthetic fixture and public application runner' : 'Synthetic reproduction example' }] },
    paragraph(repro.title),
    paragraph(execution
      ? `Original and synthetic inputs failed the same declared assertion in the source operator’s local report. ${execution.evidenceLevel === 'fix-validated' ? 'All three fixed-code inputs passed.' : 'Fix pending; no fixed revision was required.'} Forge validated evidence consistency and binding; this is a self-report, not remote execution attestation. The recipient can run the synthetic input. Replacement does not establish anonymity.`
      : applicationCase
      ? 'This package is runner-ready. Forge checked the synthetic data and preflight comparisons below; it has not executed either application revision for this fixture. Review and run the included application runner locally before claiming an application result. Synthesis does not establish anonymity.'
      : 'This example checks a selected data condition using a deterministic example handler. It does not establish that the customer’s application was reproduced or that the data is anonymous.'),
    paragraph(applicationWorkflow
      ? `Declared assertion: ${execution?.assertionId}. Ordinary control: ${execution?.ordinaryControl}. Run the actual reviewed application test below; private original-input results cannot be independently rerun from this package.`
      : applicationCase
      ? `Preflight example counts only — expected: ${repro.comparison.expected} ${repro.comparison.unit}; synthetic example handler: ${repro.comparison.synthetic}; reference correction: ${repro.comparison.fixed}. These are not recorded application-run results.`
      : `Expected: ${repro.comparison.expected} ${repro.comparison.unit}. Example handler with synthetic data: ${repro.comparison.synthetic}. Corrected example handler: ${repro.comparison.fixed}.`),
    { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: applicationCase ? 'Preflight data checks (not application execution)' : 'Checks' }] },
    ...repro.checks.map(c => paragraph(`${c.passed ? 'PASS' : 'CHECK'} — ${c.label}: ${c.detail}`)),
  ];
  if (applicationCase) content.push(
    { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Pinned public application case' }] },
    paragraph(applicationCase.title),
    paragraph(`Public issue: ${applicationCase.issueUrl}`),
    paragraph(`${applicationCase.id === 'hermes-integer-coercion' ? 'Proposed upstream fix (open proposal, not claimed merged)' : 'Merged upstream fix'}: ${applicationCase.fixUrl}`),
    paragraph(`Affected revision: ${applicationCase.affectedRevision}`),
    paragraph(`Proposed-fix revision: ${applicationCase.proposedFixRevision}`),
    paragraph(`Application entry point: ${applicationCase.entrypoint}`),
    paragraph(`Input contract: ${applicationCase.inputContract}`),
    paragraph(`Run scope: ${applicationCase.scope}`),
    paragraph('Value-replacement checks apply to the generated fixture. The runner also contains public upstream code and a fixed public regression baseline; its identifiers can match the built-in public sample. This is not a guarantee that every value in the package differs from the input or that the output is anonymous. Review both files before sharing.'),
    ...applicationCase.requirements.map(requirement => paragraph(`Requirement: ${requirement}`)),
  );
  if (repro.inputContract) content.push(
    { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Declared public input requirements' }] },
    paragraph('Original, ordinary replacement and synthetic fixture satisfy this bounded contract. It does not cover undeclared application preconditions. Explicitly public enum constants may be retained.'),
    { type: 'codeBlock', attrs: { language: 'json' }, content: [{ type: 'text', text: JSON.stringify(repro.inputContract, null, 2) }] },
    paragraph(`Input contract SHA-256: ${repro.inputContractHash}`),
  );
  if (repro.localVerification) content.push(
    { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Local application execution (self-reported)' }] },
    paragraph(`The reviewer imported a local report: original and synthetic inputs failed the same named assertion. Ordinary control: ${execution?.ordinaryControl ?? 'measured'}. ${execution?.evidenceLevel === 'fix-validated' ? 'All three fixed-code inputs passed.' : 'Fix pending; fixed-code validation was not claimed.'} Forge checked shape, checksums and test/package binding; it did not execute or remotely attest to application code.`),
    paragraph(`Assertion: ${repro.localVerification.assertionId}; failure kind: ${repro.localVerification.failureKind}`),
    paragraph(`Public evidence SHA-256: ${execution?.evidenceHash ?? 'not supplied'}. The public receipt is included in the approved runner. Original source, configuration, command and private-report fingerprints are excluded. Only declared application files are covered.`),
  );
  content.splice(3, 0,
    { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: applicationCase || applicationWorkflow ? 'Run the included application assertion locally' : 'Run the included example' }] },
    paragraph(`Download ${files.fixture} and ${files.harness} into the same folder. ${applicationWorkflow ? 'Use Node.js 24 or later and the application runtimes/dependencies declared in the reviewed code. Inspect every embedded file before explicitly authorising execution.' : `Use the runtimes declared above${applicationCase ? '' : ', or Node.js 22 or later for the reference example'}.`}`),
    { type: 'codeBlock', attrs: { language: 'bash' }, content: [{ type: 'text', text: `node ${files.harness}${applicationWorkflow ? ' --allow-command' : ''} ${files.fixture}` }] },
  );
  content.push(paragraph(`Fixture SHA-256: ${repro.fixtureHash}`), ...repro.limits.map(limit => paragraph(limit)));
  if (aiBrief) {
    const section = (title: string, items: string[]): Node[] => [
      { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: title }] },
      ...items.map(paragraph),
    ];
    content.push(
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Reviewed AI investigation brief' }] },
      paragraph(aiBrief.title), paragraph(aiBrief.summary),
      paragraph(execution
        ? 'AI suggestions explain the reviewed public test requirements and local self-report. They are proposals, not additional execution evidence, a root-cause diagnosis or approval to share private data.'
        : applicationCase
        ? `AI suggestions below are reviewable guidance, not application-run evidence. Forge has not executed this runner.${applicationCase.id === 'hermes-integer-coercion' ? ' The proposed-fix revision remains an unmerged public proposal.' : ' The referenced es-toolkit fix is merged upstream.'}`
        : 'AI suggestions below guide investigation. The executable checks above establish only the selected condition in the example handlers.'),
      ...section(applicationCase ? 'Suggested local run' : 'Try this in the application', aiBrief.reproductionSteps),
      ...section('Where to investigate', aiBrief.investigationAreas),
      ...section('Suggested acceptance checks', aiBrief.acceptanceCriteria),
      paragraph(aiBrief.caution), paragraph(`Generated with Atlassian-hosted ${aiBrief.model}; fixture ${aiBrief.fixtureHash}.`),
    );
  }
  if (publicationReference) content.push(paragraph(`ReproShare publication reference: ${publicationReference}`));
  if (sourceKey) content.push(paragraph(`Source issue reference, explicitly included by the reviewer: ${sourceKey}`));
  return { type: 'doc', version: 1, content };
}
