import { describe, expect, it } from 'vitest';
import { reproDescription } from '../../src/server/adf';
import { exampleApplicationRepro, exampleRepro } from './fixtures';
import type { AiBrief } from '../../src/shared/contracts';

const files = { fixture: 'reproshare-123.json', harness: 'reproshare-123.mjs' };
const brief = (): AiBrief => ({
  fixtureHash: exampleRepro().fixtureHash,
  title: 'Investigate repeated processing',
  summary: 'The synthetic example processes a repeated event twice.',
  reproductionSteps: ['Run the included fixture through the corresponding application boundary.'],
  investigationAreas: ['Inspect the event identity and deduplication boundary.'],
  acceptanceCriteria: ['The repeated synthetic event produces one business action.'],
  caution: 'This guidance does not establish that the customer application was reproduced.',
  model: 'claude-sonnet-4-5',
});

describe('engineering issue description', () => {
  it('does not export a source issue reference unless explicitly supplied', () => {
    expect(JSON.stringify(reproDescription(exampleRepro(), files))).not.toContain('PRIVATE-7');
    expect(JSON.stringify(reproDescription(exampleRepro(), files, 'PRIVATE-7'))).toContain('Source issue reference, explicitly included by the reviewer: PRIVATE-7');
  });

  it('uses an explicit metadata allowlist instead of embedding whole preparation artifacts', () => {
    const repro = exampleRepro();
    Object.assign(repro, { sourceHash: 'private-source-hash', reportMarkdown: 'private-report-sentinel', fixtureJson: 'private-fixture-sentinel', ordinaryJson: 'private-baseline-sentinel', harnessCode: 'private-harness-sentinel', transformations: [{ path: 'private-transformation-sentinel', rule: 'private-rule-sentinel' }] });
    const result = JSON.stringify(reproDescription(repro, files));
    for (const sentinel of ['private-source-hash', 'private-report-sentinel', 'private-fixture-sentinel', 'private-baseline-sentinel', 'private-harness-sentinel', 'private-transformation-sentinel', 'private-rule-sentinel']) expect(result).not.toContain(sentinel);
    expect(result).toContain(repro.fixtureHash);
    expect(result).toContain('node reproshare-123.mjs reproshare-123.json');
    expect(result).toContain('does not establish');
  });

  it('stores dynamic titles as plain ADF text with no executable links or markup', () => {
    const repro = exampleRepro();
    repro.title = '<script>alert(1)</script> [click](javascript:alert(1))';
    const result = reproDescription(repro, files);
    expect(result).toMatchObject({ type: 'doc', version: 1 });
    expect(result.content[1]).toEqual({ type: 'paragraph', content: [{ type: 'text', text: repro.title }] });
    expect(JSON.stringify(result)).not.toContain('"marks"');
  });

  it('includes a reviewed brief only when passed explicitly and keeps deterministic evidence authoritative', () => {
    const repro = exampleRepro();
    Object.assign(repro, { aiBrief: brief(), aiInvestigation: { explanation: 'PRIVATE_AI_ANALYSIS' } });
    expect(JSON.stringify(reproDescription(repro, files))).not.toContain('Reviewed AI investigation brief');
    const result = JSON.stringify(reproDescription(repro, files, undefined, 'publication-reference', brief()));
    expect(result).toContain('Reviewed AI investigation brief');
    expect(result).toContain(brief().summary);
    expect(result).toContain('Expected: 1 events. Example handler with synthetic data: 2. Corrected example handler: 1.');
    expect(result).toContain(`Fixture SHA-256: ${repro.fixtureHash}`);
    expect(result).toContain('AI suggestions below guide investigation');
    expect(result).not.toContain('PRIVATE_AI_ANALYSIS');
    expect(result).not.toContain(repro.sourceHash);
  });

  it('renders every generated brief field as plain text paragraphs without interpreting HTML or markdown', () => {
    const hostile = '<script>alert(1)</script> [open](javascript:alert(1)) **bold**';
    const value: AiBrief = {
      ...brief(), title: `Title ${hostile}`, summary: `Summary ${hostile}`,
      reproductionSteps: [`Step ${hostile}`], investigationAreas: [`Area ${hostile}`],
      acceptanceCriteria: [`Acceptance ${hostile}`], caution: `Caution ${hostile}`, model: `Model ${hostile}`,
    };
    const result = reproDescription(exampleRepro(), files, undefined, undefined, value);
    const paragraphs = [value.title, value.summary, ...value.reproductionSteps, ...value.investigationAreas, ...value.acceptanceCriteria, value.caution, `Generated with Atlassian-hosted ${value.model}; fixture ${value.fixtureHash}.`];
    for (const text of paragraphs) expect(result.content).toContainEqual({ type: 'paragraph', content: [{ type: 'text', text }] });
    expect(JSON.stringify(result)).not.toContain('"marks"');
    expect(JSON.stringify(result)).not.toContain('"href"');
    expect(JSON.stringify(result)).not.toContain('"type":"inlineCard"');
  });

  it('allowlists briefing fields instead of copying private investigation context or arbitrary metadata', () => {
    const value = Object.assign(brief(), {
      investigation: { explanation: 'PRIVATE_AI_EXPLANATION' },
      sourceJson: 'PRIVATE_SOURCE_JSON', sourceSummary: 'PRIVATE_SOURCE_SUMMARY',
      sourceHash: 'PRIVATE_SOURCE_HASH', comparison: { expected: 999 },
    });
    const result = JSON.stringify(reproDescription(exampleRepro(), files, undefined, undefined, value));
    for (const sentinel of ['PRIVATE_AI_EXPLANATION', 'PRIVATE_SOURCE_JSON', 'PRIVATE_SOURCE_SUMMARY', 'PRIVATE_SOURCE_HASH', '999']) expect(result).not.toContain(sentinel);
    expect(result).toContain(value.title);
    expect(result).toContain(exampleRepro().fixtureHash);
  });

  it('publishes pinned application metadata and run requirements without treating preflight checks as an application run', () => {
    const repro = exampleApplicationRepro();
    Object.assign(repro.applicationCase!, { privateSource: 'PRIVATE_APPLICATION_METADATA' });
    const result = JSON.stringify(reproDescription(repro, files));
    expect(result).toContain('runner-ready');
    expect(result).toContain('has not executed either application revision for this fixture');
    expect(result).toContain('These are not recorded application-run results');
    expect(result).toContain('open proposal, not claimed merged');
    expect(result).toContain('Value-replacement checks apply to the generated fixture');
    expect(result).toContain('fixed public regression baseline; its identifiers can match the built-in public sample');
    expect(result).toContain('not a guarantee that every value in the package differs from the input');
    for (const value of [repro.applicationCase!.issueUrl, repro.applicationCase!.fixUrl, repro.applicationCase!.affectedRevision,
      repro.applicationCase!.proposedFixRevision, repro.applicationCase!.entrypoint, repro.applicationCase!.inputContract,
      ...repro.applicationCase!.requirements, repro.applicationCase!.scope]) expect(result).toContain(value);
    expect(result).toContain('node reproshare-123.mjs reproshare-123.json');
    expect(result).not.toContain('PRIVATE_APPLICATION_METADATA');
    expect(result).not.toContain(repro.sourceHash);
    expect(result).not.toContain('"marks"');
  });

  it('keeps application-case AI guidance separate from unexecuted runner evidence', () => {
    const repro = exampleApplicationRepro();
    const result = JSON.stringify(reproDescription(repro, files, undefined, undefined, { ...brief(), fixtureHash: repro.fixtureHash }));
    expect(result).toContain('AI suggestions below are reviewable guidance, not application-run evidence');
    expect(result).toContain('Suggested local run');
    expect(result).not.toContain('Try this in the application');
  });
});
