import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { approvedTargetDenialResult, approvedWorkflowResult, parseWorkflowProbeOptions, receiverIdentityMatches, validateWorkflowProbePolicy, waitForTargetRevocation, workflowDenialResult } from '../../scripts/mcp-workflow-verify.mjs';
import { canonicalJson } from '../../local/json.mjs';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const input = { issueKey: 'R4D6A78-1', denyIssueKey: 'R4S6A78-1', unapprovedIssueKey: 'R4D6A78-2' };
const allowlist = { site: 'https://one-atlas-axke.atlassian.net', existingProjectsMayBeWritten: false,
  createdProjects: [{ role: 'source', id: '10204', key: 'R4S6A78' }, { role: 'destination', id: '10205', key: 'R4D6A78' }],
  allowedIssueKeys: [input.issueKey, input.denyIssueKey, input.unapprovedIssueKey] };
const args = ['--allowlist', 'artifacts/live/v4-current-workflow/project-allowlist.json', '--issue', input.issueKey,
  '--deny-issue', input.denyIssueKey, '--unapproved-issue', input.unapprovedIssueKey, '--expected-fixture-sha256', 'a'.repeat(64),
  '--expected-runner-sha256', 'b'.repeat(64), '--expected-actor-sha256', 'c'.repeat(64), '--out', 'new-report.json', '--artifacts', 'new-public-directory'];

describe('fresh-project receiving-user MCP probe policy (no network)', () => {
  it('matches only the expected receiving account and returns no raw user profile', () => {
    const profile = { account_id: 'fictional-receiver-B', email: 'private-test@example.test', name: 'Private test user' };
    expect(receiverIdentityMatches(profile, digest(profile.account_id))).toBe(true);
    expect(receiverIdentityMatches({ ...profile, account_id: 'fictional-owner-A' }, digest(profile.account_id))).toBe(false);
    expect(() => receiverIdentityMatches({ email: profile.email }, digest(profile.account_id))).toThrow('receiver-identity-malformed');
    expect(() => receiverIdentityMatches(profile, 'not-a-trusted-hash')).toThrow('receiver-identity-malformed');
  });

  it('requires fresh SDK authorization or an explicitly local validation-only mode', () => {
    expect(() => parseWorkflowProbeOptions(args)).toThrow('fresh-sdk-authorization-required');
    expect(parseWorkflowProbeOptions([...args, '--authorize', '--sdk-session', '--no-open'])).toMatchObject({ authorize: true, sdkSession: true, noOpen: true });
    expect(parseWorkflowProbeOptions([...args, '--authorize', '--sdk-session', '--pause-for-target-denial'])).toMatchObject({ pauseForTargetDenial: true });
    expect(parseWorkflowProbeOptions([...args, '--validate-only'])).toMatchObject({ validateOnly: true });
    expect(() => parseWorkflowProbeOptions([...args, '--authorize', '--sdk-session', '--expected-actor-sha256', 'd'.repeat(64)])).toThrow('duplicate-option');
  });

  it('requires exact new project identities and every requested issue in the explicit list', () => {
    expect(validateWorkflowProbePolicy(allowlist, input)).toMatchObject({ sourceProjectId: '10204', destinationProjectId: '10205' });
    expect(() => validateWorkflowProbePolicy({ ...allowlist, allowedIssueKeys: undefined }, input)).toThrow('exact-new-issue-allowlist-required');
    expect(() => validateWorkflowProbePolicy(allowlist, { ...input, issueKey: 'RPDEV-4' })).toThrow('unexpected-project-key');
    expect(() => validateWorkflowProbePolicy(allowlist, { ...input, issueKey: 'R4D6A78-99' })).toThrow('issue-not-explicitly-allowlisted');
    expect(() => validateWorkflowProbePolicy({ ...allowlist, createdProjects: [...allowlist.createdProjects, { role: 'other', id: '10001', key: 'KAN' }] }, input)).toThrow('fresh-project-allowlist-required');
    expect(() => validateWorkflowProbePolicy({ ...allowlist, createdProjects: [{ role: 'source', id: '10001', key: 'R4S6A78' }, allowlist.createdProjects[1]] }, input)).toThrow('unexpected-project-in-allowlist');
  });

  it('saves only a matching approved public package and returns no artifact for wrong hashes or private reports', () => {
    const fixtureJson = '{"reference":"synthetic-example-only"}';
    const verificationSpec = { version: 1, id: 'test-public-spec', assertionId: 'test.assertion', failureKind: 'test-kind',
      affected: { revision: 'test-before', files: [{ path: 'case.mjs', sha256: 'a'.repeat(64) }] } };
    const fail = { outcome: 'fail', matchedExpected: true, assertionId: verificationSpec.assertionId, failureKind: verificationSpec.failureKind };
    const publicPart = { version: 1, kind: 'reproshare-public-verification', sourceKind: 'private-original-checked-locally', bindingId: 'test-random-binding',
      contractHash: 'a'.repeat(64), ordinaryHash: 'b'.repeat(64), fixtureHash: digest(fixtureJson),
      runner: { revision: 'test-tool', sha256: 'c'.repeat(64), nodeVersion: 'v24.22.3' }, adapters: { affected: verificationSpec.affected },
      assertionId: verificationSpec.assertionId, failureKind: verificationSpec.failureKind, inputValidity: { original: true, ordinary: true, synthetic: true },
      matrix: { original: fail, synthetic: fail, ordinary: { outcome: 'pass', matchedExpected: true, assertionId: verificationSpec.assertionId } },
      verdict: 'verified', failures: [], scope: 'local-self-report-declared-files-only', ordinaryControl: 'hides-failure', repetitions: 1,
      testSpecHash: digest(canonicalJson(verificationSpec)), evidenceLevel: 'failure-reproduced' };
    const localVerification = { ...publicPart, evidenceHash: digest(canonicalJson(publicPart)) };
    const harnessCode = '// reviewed public test\n// Public receipt: ' + JSON.stringify(localVerification) + '\n';
    const body = { status: 'approved_synthetic_example', issueKey: input.issueKey, fixtureJson, harnessCode, fixtureHash: digest(fixtureJson),
      localVerification, verificationSpec };
    const rpc = { result: { content: [{ type: 'text', text: JSON.stringify(body) }] } };
    const expected = { issueKey: input.issueKey, fixtureSha256: digest(fixtureJson), runnerSha256: digest(harnessCode) };
    expect(approvedWorkflowResult(rpc, expected)).toMatchObject({ summary: { matchesExpectedApprovedBytes: true }, artifacts: { fixtureJson, harnessCode } });
    expect(approvedWorkflowResult(rpc, { ...expected, runnerSha256: '0'.repeat(64) }).artifacts).toBeUndefined();
    expect(approvedWorkflowResult({ result: { structuredContent: { ...body, localVerification: { kind: 'reproshare-local-verification', sourceHash: 'private' } } } }, expected).artifacts).toBeUndefined();
    expect(approvedWorkflowResult({ result: { structuredContent: { ...body, sourceHash: 'private' } } }, expected).artifacts).toBeUndefined();
    expect(approvedWorkflowResult({ result: { structuredContent: { ...body, localVerification: { ...localVerification, privateReport: { sourceHash: 'private' } } } } }, expected).artifacts).toBeUndefined();
    expect(approvedWorkflowResult({ result: { structuredContent: { ...body, issueKey: 'RPDEV-4' } } }, expected).artifacts).toBeUndefined();
  });

  it('does not call a generic tool/RPC failure verified permission denial or accept an artifact on a denied path', () => {
    expect(workflowDenialResult({ result: { structuredContent: { status: 'not_available' } } })).toEqual({ verified: true, category: 'not-available-no-artifact' });
    expect(workflowDenialResult({ result: { isError: true, content: [{ type: 'text', text: 'private error' }] } })).toEqual({ verified: false, category: 'tool-error-inconclusive' });
    expect(workflowDenialResult({ error: { code: -32603 } }).verified).toBe(false);
    expect(workflowDenialResult({ result: { structuredContent: { status: 'not_available', fixtureJson: 'unexpected data' } } })).toEqual({ verified: false, category: 'unexpected-artifact-returned' });
    expect(workflowDenialResult({ result: { content: [{ type: 'text', text: '{"status":"not_available"}' }, { type: 'text', text: 'unexpected unparsed data' }] } }).verified).toBe(false);
  });

  it('requires current-access denial on the SAME approved target rather than absence of an approval receipt', () => {
    const noReceipt = { result: { structuredContent: { status: 'not_available', message: 'This issue has no complete ReproShare publication receipt.' } } };
    expect(workflowDenialResult(noReceipt).verified).toBe(true);
    expect(approvedTargetDenialResult(noReceipt)).toMatchObject({ verified: false, reason: 'no-publication-receipt' });
    const deniedAccess = { result: { structuredContent: { status: 'not_available', message: 'No approved package is available under your current access.' } } };
    expect(approvedTargetDenialResult(deniedAccess)).toMatchObject({ verified: true, reason: 'current-access-unavailable', noArtifactFieldsReturned: true });
    expect(approvedTargetDenialResult({ result: { structuredContent: { status: 'approved_synthetic_example', fixtureJson: 'unexpected artifact' } } }).verified).toBe(false);
  });

  it('waits for the explicit revocation signal without reading credentials or accepting extra input', async () => {
    const stream = new PassThrough();
    const wait = waitForTargetRevocation(stream, 1000);
    stream.write('CHECK_'); stream.write('REVOKED\n');
    await expect(wait).resolves.toBeUndefined();
    expect(stream.listenerCount('data')).toBe(0);
    stream.destroy();
    const malformed = new PassThrough();
    const bad = waitForTargetRevocation(malformed, 1000);
    malformed.write('anything-else\n');
    await expect(bad).rejects.toThrow('revocation-check-signal-invalid'); malformed.destroy();
    const closed = new PassThrough();
    const ended = waitForTargetRevocation(closed, 1000); closed.end();
    await expect(ended).rejects.toThrow('revocation-signal-stream-closed');
    const timeout = new PassThrough();
    await expect(waitForTargetRevocation(timeout, 10)).rejects.toThrow('revocation-check-timeout'); timeout.destroy();
  });

  it('offers a help-only path and contains no historical issue fallback or browser/artifact execution', async () => {
    const result = spawnSync(process.execPath, [resolve('scripts/mcp-workflow-verify.mjs'), '--help'], { encoding: 'utf8', timeout: 10000 });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('never opens Chrome');
    const source = await readFile(resolve('scripts/mcp-workflow-verify.mjs'), 'utf8');
    expect(source).not.toContain('RPDEV-4');
    expect(source).not.toContain("from 'node:child_process'");
    expect(source).toContain('consent bridge');
  });
});
