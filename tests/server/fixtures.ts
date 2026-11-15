import type { ApplicationCase, PreparedRepro } from '../../src/shared/contracts';
import { createHash } from 'node:crypto';

export const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');

export function exampleRepro(): PreparedRepro {
  const fixtureJson = '{"events":[{"eventId":"synthetic_1"},{"eventId":"synthetic_1"}]}';
  return {
    version: 1,
    profileId: 'duplicates',
    title: 'Repeated event IDs require idempotent handling',
    sourceHash: sha256('original-private-source'),
    fixtureHash: sha256(fixtureJson),
    fixtureJson,
    selectedPaths: ['$.events[0].eventId', '$.events[1].eventId'],
    ordinaryJson: '{"ordinary":"synthetic"}',
    checks: [{ id: 'condition', label: 'Selected condition', passed: true, detail: 'The repeated synthetic IDs are preserved.' }],
    comparison: { label: 'Events processed', expected: 1, source: 2, ordinary: 2, synthetic: 2, fixed: 1, unit: 'events' },
    transformations: [{ path: '$.events[*].eventId', rule: 'Synthesize identifiers consistently.' }],
    changedValueCount: 2,
    limits: ['These checks do not execute the customer application.'],
    reportMarkdown: 'A synthetic example report.',
    harnessCode: 'console.log("synthetic example");\n',
  };
}

export function exampleApplicationCase(): ApplicationCase {
  return {
    id: 'hermes-integer-coercion', title: 'Pinned public Hermes integer-coercion case',
    issueUrl: 'https://example.test/public/hermes-issue', fixUrl: 'https://example.test/public/hermes-proposed-fix',
    affectedRevision: 'a'.repeat(40), proposedFixRevision: 'b'.repeat(40),
    entrypoint: 'hermes_tool_calling.coerce_tool_arguments',
    inputContract: 'calls[].chat_id contains positive canonical signed 64-bit integer strings.',
    requirements: ['Node.js 22 or later', 'Python 3.11 or later; bundled pinned source runs offline'],
    scope: 'Pinned public coercion entry point only; no tool dispatch or message delivery.',
    status: 'runner-ready',
  };
}

export function exampleApplicationRepro(): PreparedRepro {
  const fixtureJson = '{"calls":[{"chat_id":"1234567890123456789"},{"chat_id":"1234567890123456790"}]}';
  return {
    ...exampleRepro(), profileId: 'precision', title: 'Public application runner package', fixtureJson,
    fixtureHash: sha256(fixtureJson), selectedPaths: ['$.calls[0].chat_id', '$.calls[1].chat_id'],
    comparison: { label: 'Preflight identity comparison', expected: 2, source: 1, ordinary: 2, synthetic: 1, fixed: 2, unit: 'identities' },
    harnessCode: '// Unit-test stand-in for the separately tested offline application runner.\n',
    applicationCase: exampleApplicationCase(),
  };
}
