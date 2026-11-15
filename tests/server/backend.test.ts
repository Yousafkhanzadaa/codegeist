import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { actorKey, publicationKey } from '../../src/server/validation';
import { exampleApplicationRepro, exampleRepro, sha256 } from './fixtures';
import { prepareRepro, samplePayloads, scanForInvestigation, scanPayload } from '../../src/domain/index';
import type { AiBrief, ReviewDraft } from '../../src/shared/contracts';
import { canonicalJson } from '../../src/domain/verification';
import { prepareLocalWorkflow } from '../../src/domain/local-workflow';

type ResolverHandler = (request: { payload: unknown; context: Record<string, unknown> }) => Promise<unknown>;
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, ResolverHandler>(),
  values: new Map<string, unknown>(),
  request: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
  asApp: vi.fn(),
  prepareRepro: vi.fn(),
  ai: {
    startAiInvestigation: vi.fn(),
    getAiJob: vi.fn(),
    startAiBrief: vi.fn(),
    assertInvestigation: vi.fn(),
    getAiBriefForPublish: vi.fn(),
    runAiJob: vi.fn(),
  },
}));

vi.mock('@forge/resolver', () => ({ default: class {
  define(name: string, fn: ResolverHandler) { mocks.handlers.set(name, fn); }
  getDefinitions() { return mocks.handlers; }
} }));
vi.mock('@forge/api', () => ({
  default: { asUser: () => ({ requestJira: mocks.request }), asApp: mocks.asApp },
  route: (parts: TemplateStringsArray, ...values: unknown[]) => parts.reduce((result, part, index) => result + part + (index < values.length ? encodeURIComponent(String(values[index])) : ''), ''),
}));
vi.mock('@forge/kvs', () => ({ kvs: { get: mocks.get, set: mocks.set, delete: mocks.delete } }));
vi.mock('../../src/server/ai', () => mocks.ai);
vi.mock('../../src/domain/index', async importOriginal => {
  const original = await importOriginal<typeof import('../../src/domain/index')>();
  mocks.prepareRepro.mockImplementation(original.prepareRepro);
  return { ...original, prepareRepro: mocks.prepareRepro };
});

import { getApprovedReproducer } from '../../src/index';

const REVIEW_ID = 'b35939e6-1c29-4d81-9b18-6d727fe5c904';
const INVESTIGATION_ID = 'c35939e6-1c29-4d81-9b18-6d727fe5c904';
const BRIEF_JOB_ID = 'd35939e6-1c29-4d81-9b18-6d727fe5c904';
const OTHER_BRIEF_JOB_ID = 'e35939e6-1c29-4d81-9b18-6d727fe5c904';
const UPDATED = '2026-11-12T12:00:00.000Z';
const sourceSecret = 'PRIVATE_CUSTOMER_RECORDS_DO_NOT_EXPORT';
const context = { accountId: 'agent-a', cloudId: 'site-a', extension: { issue: { id: '100', key: 'PRIVATE-7' } } };
const input = { reviewId: REVIEW_ID, projectId: '200', issueTypeId: '300', summary: 'Synthetic reproduction', extraFields: {}, confirmedReview: true, includeSourceReference: false };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const investigationSource = JSON.stringify({ rows: [{ unusual_reference: '9007199254740992' }, { unusual_reference: '9007199254740993' }] });
const investigationCandidate = scanForInvestigation(investigationSource).candidates[0];
const investigationInput = { sourceJson: investigationSource, expectedBehavior: 'Two separate orders appear.', observedBehavior: 'Only one order appears.', consentToAi: true };
const preparationInput = { sourceJson: investigationSource, candidateId: investigationCandidate.id, seed: 'integration-ai', investigationId: INVESTIGATION_ID };

function approvedBrief(title = 'Inspect duplicate delivery handling'): AiBrief {
  return {
    fixtureHash: exampleRepro().fixtureHash,
    title,
    summary: 'The synthetic example processes the same event twice.',
    reproductionSteps: ['Run the supplied fixture and harness together.'],
    investigationAreas: ['Inspect where event identity is checked before processing.'],
    acceptanceCriteria: ['The same synthetic event is processed once.'],
    caution: 'The customer application has not been executed.',
    model: 'claude-sonnet-4-5',
  };
}

interface AttachedFile { id: string; issueId: string; filename: string; size: number; bytes: Uint8Array }
let attachments: AttachedFile[];
let requiredFields: Record<string, unknown>[];
let deniedPermission: string | undefined;
let attachmentLimit: number;
let createMode: 'normal' | 'timeout' | 'http-timeout' | 'rejected';
let uploadMode: 'normal' | 'commit-then-timeout' | 'timeout-before-commit' | 'http-timeout' | 'denied';
let targetDenied: boolean;
let sourceUpdated: string;
let sourceAttachmentBytes: Uint8Array;
let createdSelf: unknown;
let targetDeniedPermission: string | undefined;
let recoveryIssue: Record<string, unknown>;
let alternativeRecoveryIssue: Record<string, unknown> | undefined;
const OPERATION_MARKER = '4984c28b-401b-463b-8117-62e4ef592e60';
const operationKey = () => publicationKey(actorKey(context.accountId, context.cloudId), '100', exampleRepro().fixtureHash, '200');

function unknownPublication(phase = 'unknown') {
  const createdAt = Date.now();
  mocks.values.set(operationKey(), { phase, marker: OPERATION_MARKER, createdAt });
  recoveryIssue = {
    id: '500', key: 'DEV-1',
    fields: { project: { id: '200' }, creator: { accountId: context.accountId }, created: new Date(createdAt).toISOString() },
    properties: { 'reproshare.publication': { operation: OPERATION_MARKER, fixtureHash: exampleRepro().fixtureHash, profileId: exampleRepro().profileId, version: 1 } },
  };
}

function saveReview(overrides: Record<string, unknown> = {}) {
  mocks.values.set(`review-${REVIEW_ID}`, { actor: actorKey(context.accountId, context.cloudId), issueId: '100', sourceUpdated: UPDATED, createdAt: Date.now(), repro: exampleRepro(), ...overrides });
}

function run(name: string, payload: unknown = input, requestContext: Record<string, unknown> = context) {
  const fn = mocks.handlers.get(name);
  if (!fn) throw new Error(`Missing resolver ${name}`);
  return fn({ payload, context: requestContext });
}
function creates() { return mocks.request.mock.calls.filter(([path, options]) => path === '/rest/api/3/issue' && options?.method === 'POST'); }
function uploads() { return mocks.request.mock.calls.filter(([path, options]) => /^\/rest\/api\/3\/issue\/50[01]\/attachments$/.test(String(path)) && options?.method === 'POST'); }
function reservations() { return mocks.set.mock.calls.filter(([key, _value, options]) => String(key).startsWith('publication-') && options?.keyPolicy === 'FAIL_IF_EXISTS'); }

beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of Object.values(mocks.ai)) fn.mockReset();
  mocks.ai.startAiInvestigation.mockResolvedValue({ jobId: INVESTIGATION_ID });
  mocks.ai.getAiJob.mockResolvedValue({ jobId: INVESTIGATION_ID, kind: 'investigation', status: 'queued' });
  mocks.ai.startAiBrief.mockResolvedValue({ jobId: BRIEF_JOB_ID });
  mocks.ai.assertInvestigation.mockResolvedValue(undefined);
  mocks.ai.getAiBriefForPublish.mockResolvedValue(approvedBrief());
  mocks.values.clear();
  attachments = [];
  requiredFields = [{ fieldId: 'description', key: 'description', name: 'Description', required: false, hasDefaultValue: false, operations: ['set'], schema: { type: 'string', system: 'description' } }];
  deniedPermission = undefined;
  attachmentLimit = 1024 * 1024;
  createMode = 'normal';
  uploadMode = 'normal';
  targetDenied = false;
  sourceUpdated = UPDATED;
  sourceAttachmentBytes = new TextEncoder().encode(sourceSecret);
  createdSelf = 'https://api.atlassian.com/ex/jira/site-a/rest/api/3/issue/500';
  targetDeniedPermission = undefined;
  recoveryIssue = {};
  alternativeRecoveryIssue = undefined;
  mocks.get.mockImplementation(async (key: string) => {
    const value = mocks.values.get(key);
    return value === undefined ? undefined : structuredClone(value);
  });
  mocks.set.mockImplementation(async (key: string, value: unknown, options?: { keyPolicy?: string }) => {
    if (options?.keyPolicy === 'FAIL_IF_EXISTS' && mocks.values.has(key)) throw new Error('Atomic key conflict');
    mocks.values.set(key, structuredClone(value));
  });
  mocks.delete.mockImplementation(async (key: string) => { mocks.values.delete(key); });
  mocks.asApp.mockImplementation(() => { throw new Error('The backend must not use app permissions'); });
  mocks.request.mockImplementation(async (path: string, options?: { method?: string; body?: BodyInit }) => {
    if (path === '/rest/api/3/issue/100?fields=summary,updated,project,attachment') return json({ id: '100', key: 'PRIVATE-7', fields: { summary: sourceSecret, updated: sourceUpdated, project: { name: 'Private support project' }, attachment: [{ id: '900', filename: 'private-customer.json', size: 40, mimeType: 'application/json' }] } });
    if (path.startsWith('/rest/api/3/mypermissions?')) {
      const denied = /issueId=50[01]/.test(path) ? targetDeniedPermission : deniedPermission;
      const permissions = Object.fromEntries(['BROWSE_PROJECTS', 'EDIT_ISSUES', 'CREATE_ISSUES', 'CREATE_ATTACHMENTS'].map(permission => [permission, { havePermission: permission !== denied }]));
      return json({ permissions });
    }
    if (path.startsWith('/rest/api/3/issue/createmeta/200/issuetypes/300?')) return json({ fields: requiredFields, total: requiredFields.length });
    if (path === '/rest/api/3/attachment/meta') return json({ enabled: true, uploadLimit: attachmentLimit });
    if (path === '/rest/api/3/issue' && options?.method === 'POST') {
      if (createMode === 'timeout') throw new TypeError('Network response lost');
      if (createMode === 'http-timeout') return json({}, 408);
      if (createMode === 'rejected') return json({ errors: { summary: 'Rejected' } }, 400);
      return json({ id: '500', key: 'DEV-1', self: createdSelf }, 201);
    }
    if (/^\/rest\/api\/3\/issue\/(DEV-1|500)\/properties\/reproshare\.publication$/.test(path)) {
      const properties = recoveryIssue.properties as Record<string, unknown> | undefined;
      return properties?.['reproshare.publication'] ? json({ key: 'reproshare.publication', value: properties['reproshare.publication'] }) : json({}, 404);
    }
    if (/^\/rest\/api\/3\/issue\/(DEV-1|500)\?/.test(path) && /project|creator|created|properties/.test(path)) return targetDenied ? json({}, 403) : json(recoveryIssue);
    if (/^\/rest\/api\/3\/issue\/(DEV-2|501)\?/.test(path) && /project|creator|created|properties/.test(path)) return alternativeRecoveryIssue ? json(alternativeRecoveryIssue) : json({}, 404);
    const targetRead = /^\/rest\/api\/3\/issue\/(500|501|DEV-1|DEV-2)\?fields=attachment$/.exec(path);
    if (targetRead) {
      const issueId = ['501', 'DEV-2'].includes(targetRead[1]) ? '501' : '500';
      return targetDenied ? json({}, 403) : json({ id: issueId, key: issueId === '500' ? 'DEV-1' : 'DEV-2', fields: { attachment: attachments.filter(file => file.issueId === issueId).map(({ bytes: _bytes, issueId: _issueId, ...metadata }) => metadata) } });
    }
    const uploadTarget = /^\/rest\/api\/3\/issue\/(500|501)\/attachments$/.exec(path);
    if (uploadTarget && options?.method === 'POST') {
      if (uploadMode === 'denied') return json({}, 403);
      if (uploadMode === 'http-timeout') return json({}, 408);
      if (uploadMode === 'timeout-before-commit') throw new TypeError('Upload response lost');
      const headers = (options as { headers: HeadersInit }).headers;
      const form = await new Response(options.body, { headers }).formData();
      const file = form.get('file') as File;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const attachment = { id: String(1000 + attachments.length), issueId: uploadTarget[1], filename: file.name, size: bytes.length, bytes };
      attachments.push(attachment);
      if (uploadMode === 'commit-then-timeout') { uploadMode = 'normal'; throw new TypeError('Upload committed but response lost'); }
      return json([{ id: attachment.id }]);
    }
    const content = /^\/rest\/api\/3\/attachment\/content\/(\d+)\?redirect=false$/.exec(path);
    if (content) {
      if (content[1] === '900') return new Response(new Uint8Array(sourceAttachmentBytes).buffer);
      const attachment = attachments.find(file => file.id === content[1]);
      return attachment ? new Response(new Uint8Array(attachment.bytes).buffer) : json({}, 404);
    }
    throw new Error(`Unexpected Jira request ${options?.method ?? 'GET'} ${path}`);
  });
  saveReview();
});

describe('public application-case preparation and approved retrieval', () => {
  it('retains the public case and report context in signed-in sample results', async () => {
    const samples = await run('getSamples') as Array<Record<string, unknown>>;
    const sample = samplePayloads['hermes-integer-coercion'];
    expect(samples.find(value => value.id === 'hermes-integer-coercion')).toEqual({
      id: 'hermes-integer-coercion', title: sample.title, description: sample.description,
      sourceJson: sample.json, applicationCaseId: sample.applicationCaseId,
      expectedBehavior: sample.expectedBehavior, observedBehavior: sample.observedBehavior,
    });
  });

  it.each(['unknown-case', '', null, false, { id: 'hermes-integer-coercion' }])('rejects unsupported application case %j before engine, AI or storage writes', async applicationCaseId => {
    await expect(run('prepare', { ...preparationInput, applicationCaseId })).rejects.toThrow('supported public application case');
    expect(mocks.prepareRepro).not.toHaveBeenCalled();
    expect(mocks.ai.assertInvestigation).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it('passes only the known case ID to the engine and stores its server-produced runner metadata', async () => {
    const repro = exampleApplicationRepro();
    mocks.prepareRepro.mockReturnValueOnce(repro);
    const prepareInput = { sourceJson: samplePayloads['hermes-integer-coercion'].json, candidateId: 'candidate-from-current-scan', seed: 'public-case', applicationCaseId: 'hermes-integer-coercion' };
    const result = await run('prepare', { ...prepareInput, applicationCase: { title: sourceSecret }, status: 'application-passed', harnessCode: sourceSecret }) as { reviewId: string; repro: unknown };
    expect(mocks.prepareRepro).toHaveBeenCalledExactlyOnceWith(prepareInput, { allowAnyStringFields: false });
    expect(result.repro).toEqual(repro);
    expect(mocks.values.get(`review-${result.reviewId}`)).toMatchObject({ actor: actorKey(context.accountId, context.cloudId), repro });
    expect(JSON.stringify(result)).not.toContain('application-passed');
  });

  it('stores allowlisted runner metadata only in a completed receipt and returns it with hash-verified files', async () => {
    const repro = exampleApplicationRepro();
    const expectedCase = structuredClone(repro.applicationCase!);
    Object.assign(repro.applicationCase!, { privateSource: sourceSecret, claimedExecution: 'application-passed' });
    saveReview({ repro });
    await run('publish');
    expect(mocks.values.get('receipt-500')).toMatchObject({ applicationCase: expectedCase });
    expect(JSON.stringify(mocks.values.get('receipt-500'))).not.toContain(sourceSecret);
    const output = await getApprovedReproducer({ issueKey: 'DEV-1', applicationCase: { status: 'application-passed' } }, context);
    expect(output).toMatchObject({ applicationCase: expectedCase, fixtureJson: repro.fixtureJson, harnessCode: repro.harnessCode });
    expect(output).toMatchObject({ instruction: expect.stringContaining('Forge has not executed the application for this fixture') });
    expect(output).toMatchObject({ instruction: expect.stringContaining('fixed public regression baseline whose identifiers can match the built-in public sample') });
    expect(JSON.stringify(output)).not.toContain('application-passed');
    expect(JSON.stringify(output)).not.toContain(sourceSecret);
    expect(mocks.asApp).not.toHaveBeenCalled();
  });

  it('does not return application metadata from caller input or a damaged approved package', async () => {
    await expect(getApprovedReproducer({ issueKey: 'DEV-1', applicationCase: exampleApplicationRepro().applicationCase }, context)).resolves.toMatchObject({ status: 'not_available' });
    saveReview({ repro: exampleApplicationRepro() });
    await run('publish');
    const harness = attachments.find(value => value.filename.endsWith('.mjs'))!;
    harness.bytes = new TextEncoder().encode('console.log("changed application runner")');
    harness.size = harness.bytes.length;
    await expect(getApprovedReproducer({ issueKey: 'DEV-1' }, context)).rejects.toThrow('changed');
  });

  it('keeps runner publication identity separate from a generic package with identical fixture bytes', async () => {
    const repro = exampleApplicationRepro();
    const genericKey = publicationKey(actorKey(context.accountId, context.cloudId), '100', repro.fixtureHash, '200');
    const genericOperation = { phase: 'complete', marker: OPERATION_MARKER, createdAt: Date.now(), issueId: '500', issueKey: 'DEV-1', issueUrl: '/browse/DEV-1' };
    mocks.values.set(genericKey, genericOperation);
    saveReview({ repro });
    await expect(run('getPublicationStatus', { reviewId: REVIEW_ID, projectId: '200' })).resolves.toBeNull();
    await run('publish');
    expect(creates()).toHaveLength(1);
    expect(reservations()[0][0]).not.toBe(genericKey);
    expect(mocks.values.get(genericKey)).toEqual(genericOperation);
  });

  it('does not reuse approved runner state after its pinned source or harness changes', async () => {
    const repro = exampleApplicationRepro();
    saveReview({ repro });
    await run('publish');
    await expect(run('getPublicationStatus', { reviewId: REVIEW_ID, projectId: '200' })).resolves.toMatchObject({ phase: 'complete', issueKey: 'DEV-1' });
    saveReview({ repro: { ...repro, harnessCode: `${repro.harnessCode}// Changed pinned runner\n` } });
    await expect(run('getPublicationStatus', { reviewId: REVIEW_ID, projectId: '200' })).resolves.toBeNull();
    saveReview({ repro: { ...repro, applicationCase: { ...repro.applicationCase!, proposedFixRevision: 'c'.repeat(40) } } });
    await expect(run('getPublicationStatus', { reviewId: REVIEW_ID, projectId: '200' })).resolves.toBeNull();
    expect(creates()).toHaveLength(1);
  });
});

describe('local execution evidence and immutable review binding', () => {
  it('publishes actual application outcomes without unmeasured reference/fix count placeholders', async () => {
    const repro = prepareLocalWorkflow(readFileSync(new URL('../fixtures/application-workflow-review.json', import.meta.url), 'utf8'));
    saveReview({ repro });
    await run('publish');
    expect(mocks.values.get('receipt-500')).not.toHaveProperty('comparison');
    const approved = await getApprovedReproducer({ issueKey: 'DEV-1' }, context);
    expect(approved).not.toHaveProperty('comparison');
    expect(approved).toMatchObject({ localVerification: { evidenceLevel: 'failure-reproduced' } });
    const create = creates()[0][1];
    const body = JSON.stringify(create);
    expect(body).toContain('Fix pending');
    expect(body).not.toContain('Corrected example handler: 0');
  });
  function preparedWithReport() {
    const sourceJson = readFileSync(new URL('../../examples/upstream/deburr.json', import.meta.url), 'utf8');
    const candidate = scanPayload(sourceJson).candidates.find(item => item.profileId === 'diacritics')!;
    const repro = prepareRepro({ sourceJson, candidateId: candidate.id, seed: 'codegeist-second-real-case-v1', applicationCaseId: 'es-toolkit-deburr' });
    // API fixture derived from the archived execution; historical files stay
    // immutable. Bind this unit-test report to its newly prepared review.
    const report = JSON.parse(readFileSync(new URL('../fixtures/deburr-local-report.json', import.meta.url), 'utf8'));
    report.configurationHash = repro.configurationHash; report.testSpecHash = repro.testSpecHash;
    const { evidenceHash: _prior, ...unsigned } = report;
    const reportJson = JSON.stringify({ ...unsigned, evidenceHash: sha256(canonicalJson(unsigned)) });
    saveReview({ repro });
    return { repro, reportJson };
  }
  it('stores an allowlisted report as a new review without changing the old review or extending its age', async () => {
    const { reportJson } = preparedWithReport();
    const original = structuredClone(mocks.values.get(`review-${REVIEW_ID}`));
    const result = await run('importLocalVerification', { reviewId: REVIEW_ID, reportJson }) as ReviewDraft;
    expect(result.reviewId).not.toBe(REVIEW_ID);
    expect(result.repro.localVerification?.verdict).toBe('verified');
    expect(mocks.values.get(`review-${REVIEW_ID}`)).toEqual(original);
    expect(mocks.values.get(`review-${result.reviewId}`)).toMatchObject({ createdAt: (original as { createdAt: number }).createdAt, actor: actorKey(context.accountId, context.cloudId) });
    expect(creates()).toHaveLength(0); expect(uploads()).toHaveLength(0); expect(mocks.asApp).not.toHaveBeenCalled();
    await expect(run('importLocalVerification', { reviewId: result.reviewId, reportJson })).rejects.toThrow('already has a local report');
  });
  it.each(['wrong-actor', 'wrong-source', 'expired', 'changed-source'])('rejects evidence import for %s before a storage write', async reason => {
    const { reportJson } = preparedWithReport();
    const stored = mocks.values.get(`review-${REVIEW_ID}`) as Record<string, unknown>;
    if (reason === 'wrong-actor') stored.actor = 'other';
    if (reason === 'wrong-source') stored.issueId = '101';
    if (reason === 'expired') stored.createdAt = Date.now() - 3_600_001;
    if (reason === 'changed-source') sourceUpdated = '2026-11-14T00:00:00.000Z';
    await expect(run('importLocalVerification', { reviewId: REVIEW_ID, reportJson })).rejects.toThrow();
    expect(mocks.set).not.toHaveBeenCalled(); expect(creates()).toHaveLength(0);
  });
  it('rejects a stale package and caller-supplied execution claims without replacing trusted preparation', async () => {
    const { reportJson } = preparedWithReport();
    const report = JSON.parse(reportJson); report.fixtureHash = 'f'.repeat(64);
    await expect(run('importLocalVerification', { reviewId: REVIEW_ID, reportJson: JSON.stringify(report), repro: exampleRepro(), actor: 'forged' })).rejects.toThrow('different source, fixture');
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it('publishes the reviewed evidence and bounded contract, then retrieves them only through approved attachment checks', async () => {
    const { reportJson } = preparedWithReport();
    const result = await run('importLocalVerification', { reviewId: REVIEW_ID, reportJson }) as ReviewDraft;
    await run('publish', { ...input, reviewId: result.reviewId });
    const receipt = mocks.values.get('receipt-500');
    expect(receipt).toMatchObject({ localVerification: result.repro.publicVerification, inputContractHash: result.repro.inputContractHash, privacyVersion: 2 });
    expect(JSON.stringify(receipt)).not.toContain(result.repro.sourceHash);
    expect(JSON.stringify(receipt)).not.toContain(result.repro.configurationHash);
    const approved = await getApprovedReproducer({ issueKey: 'DEV-1' }, context);
    expect(approved).toMatchObject({ localVerification: result.repro.publicVerification, inputContract: result.repro.inputContract });
    expect(JSON.stringify(approved)).not.toContain(result.repro.sourceHash);
    expect(JSON.stringify(approved)).toContain('self-report');
    const harness = attachments.find(value => value.filename.endsWith('.mjs'))!;
    harness.bytes = new TextEncoder().encode('modified evidence comment'); harness.size = harness.bytes.length;
    await expect(getApprovedReproducer({ issueKey: 'DEV-1' }, context)).rejects.toThrow('changed');
  });
  it('keeps the earlier publication identity separate when evidence is later added to identical fixture bytes', async () => {
    const { reportJson } = preparedWithReport();
    await run('publish');
    const earlierKey = reservations()[0][0];
    const originalReceipt = structuredClone(mocks.values.get('receipt-500'));
    const result = await run('importLocalVerification', { reviewId: REVIEW_ID, reportJson }) as ReviewDraft;
    await expect(run('getPublicationStatus', { reviewId: result.reviewId, projectId: '200' })).resolves.toBeNull();
    expect(mocks.values.get('receipt-500')).toEqual(originalReceipt);
    expect(mocks.values.get(String(earlierKey))).toMatchObject({ phase: 'complete' });
  });
});

describe('trusted source context and review binding', () => {
  it('rejects forged payload identity without trusted Forge identity', async () => {
    await expect(run('publish', { ...input, context, accountId: context.accountId }, { extension: context.extension })).rejects.toThrow('signed in');
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('does not select the source issue from client payload', async () => {
    await expect(run('publish', { ...input, issueId: '100' }, { accountId: context.accountId, cloudId: context.cloudId })).rejects.toThrow('Source issue');
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it.each([
    { actor: actorKey('another-agent', context.cloudId) },
    { actor: actorKey(context.accountId, 'another-site') },
    { issueId: '101' },
    { createdAt: Date.now() - 2 * 60 * 60 * 1000 },
  ])('rejects reviews outside the actor, site, source, and expiry boundary: %j', async overrides => {
    saveReview(overrides);
    await expect(run('publish')).rejects.toThrow('expired or belongs');
    expect(creates()).toHaveLength(0);
    expect(reservations()).toHaveLength(0);
  });

  it('rechecks source access and freshness when sharing', async () => {
    deniedPermission = 'EDIT_ISSUES';
    await expect(run('publish')).rejects.toThrow('view and edit');
    expect(creates()).toHaveLength(0);
    deniedPermission = undefined;
    sourceUpdated = '2026-11-12T13:00:00.000Z';
    await expect(run('publish')).rejects.toThrow('changed after');
    expect(creates()).toHaveLength(0);
  });

  it('does not fetch arbitrary attachment IDs supplied by the client', async () => {
    await expect(run('readAttachment', { attachmentId: '999' })).rejects.toThrow('from this issue');
    expect(mocks.request.mock.calls.some(([path]) => String(path).includes('/attachment/content/999'))).toBe(false);
  });

  it('reads source attachments only through current user access', async () => {
    await expect(run('readAttachment', { attachmentId: '900' })).resolves.toEqual({ text: sourceSecret });
    expect(mocks.asApp).not.toHaveBeenCalled();
    deniedPermission = 'BROWSE_PROJECTS';
    mocks.request.mockClear();
    await expect(run('readAttachment', { attachmentId: '900' })).rejects.toThrow('view and edit');
    expect(mocks.request.mock.calls.some(([path]) => String(path).includes('/attachment/content/900'))).toBe(false);
  });

  it('enforces the actual downloaded byte limit even when attachment metadata is stale', async () => {
    sourceAttachmentBytes = new Uint8Array(64 * 1024 + 1);
    await expect(run('readAttachment', { attachmentId: '900' })).rejects.toThrow('larger than 64 KiB');
  });

  it('rejects malformed UTF-8 rather than silently changing source bytes', async () => {
    sourceAttachmentBytes = new Uint8Array([0xc3, 0x28]);
    await expect(run('readAttachment', { attachmentId: '900' })).rejects.toThrow('UTF-8');
  });

  it('applies the UTF-8 input byte limit to pasted JSON as well as attachments', async () => {
    await expect(run('scan', { sourceJson: JSON.stringify({ value: 'é'.repeat(40_000) }) })).rejects.toThrow();
  });
});

describe('creation guardrails and private-source omission', () => {
  it.each([
    'https://api.atlassian.com/ex/jira/site-a/rest/api/3/issue/500',
    undefined,
    'https://untrusted.invalid/rest/api/3/issue/500',
    'javascript:alert(1)',
    'not a URL',
  ])('uses validated issue identity instead of Jira self URLs: %s', async self => {
    createdSelf = self;
    await expect(run('publish')).resolves.toMatchObject({ key: 'DEV-1', url: '/browse/DEV-1' });
    expect(creates()).toHaveLength(1);
    expect(mocks.values.get(operationKey())).toMatchObject({ phase: 'complete', issueId: '500', issueKey: 'DEV-1', issueUrl: '/browse/DEV-1' });
  });

  it('rejects a destination without Description when checking its fields', async () => {
    requiredFields = [];
    await expect(run('getFields', { projectId: '200', issueTypeId: '300' })).rejects.toThrow('Add Description to its create screen');
    expect(reservations()).toHaveLength(0);
    expect(creates()).toHaveLength(0);
    expect(uploads()).toHaveLength(0);
  });

  it('rechecks Description availability when publishing before reserving or writing', async () => {
    await expect(run('getFields', { projectId: '200', issueTypeId: '300' })).resolves.toEqual([]);
    // A Jira administrator can change the create screen after destination selection.
    requiredFields = [];
    await expect(run('publish')).rejects.toThrow('This issue type cannot accept the ReproShare report');
    expect(reservations()).toHaveLength(0);
    expect(creates()).toHaveLength(0);
    expect(uploads()).toHaveLength(0);
  });

  it.each(['project', 'issuetype', 'description', 'security', 'reporter'])('rejects injected destination field %s before reserving or writing', async field => {
    await expect(run('publish', { ...input, extraFields: { [field]: { id: 'malicious' } } })).rejects.toThrow('destination fields changed');
    expect(creates()).toHaveLength(0);
    expect(reservations()).toHaveLength(0);
  });

  it('requires destination create and attachment permissions before reserving', async () => {
    deniedPermission = 'CREATE_ATTACHMENTS';
    await expect(run('publish')).rejects.toThrow('add attachments');
    expect(creates()).toHaveLength(0);
    expect(reservations()).toHaveLength(0);
  });

  it('does not reserve a publication when generated files exceed the site upload limit', async () => {
    attachmentLimit = 1;
    await expect(run('publish')).rejects.toThrow('attachment limit');
    expect(creates()).toHaveLength(0);
    expect(reservations()).toHaveLength(0);
  });

  it('never creates an issue if the atomic reservation cannot be confirmed', async () => {
    mocks.set.mockRejectedValue(new Error('Storage outage'));
    await expect(run('publish')).rejects.toThrow('Nothing was created');
    expect(creates()).toHaveLength(0);
    expect(uploads()).toHaveLength(0);
  });

  it.each([false, true])('includes the source key only for explicit reviewer choice %s', async includeSourceReference => {
    await expect(run('publish', { ...input, includeSourceReference, fixtureJson: sourceSecret, actor: 'forged' })).resolves.toMatchObject({ key: 'DEV-1' });
    const body = JSON.parse(creates()[0][1].body as string);
    const serialized = JSON.stringify(body);
    expect(serialized.includes('PRIVATE-7')).toBe(includeSourceReference);
    expect(serialized).not.toContain(sourceSecret);
    expect(serialized).not.toContain('private-customer.json');
    expect(body.fields).not.toHaveProperty('attachment');
    expect(attachments.map(file => new TextDecoder().decode(file.bytes))).toEqual([exampleRepro().fixtureJson, exampleRepro().harnessCode]);
    expect(mocks.asApp).not.toHaveBeenCalled();
  });
});

describe('unknown creation recovery', () => {
  function recoveryClaim() {
    const operation = mocks.values.get(operationKey()) as Record<string, unknown>;
    return { ...operation, phase: 'created', issueId: '500', issueKey: 'DEV-1', issueUrl: '/browse/DEV-1' };
  }

  it('adopts the explicitly selected issue only after all publication bindings match', async () => {
    unknownPublication();
    await expect(run('publish', { ...input, recoverIssueKey: 'DEV-1' })).resolves.toMatchObject({ key: 'DEV-1', url: '/browse/DEV-1', reused: true });
    expect(creates()).toHaveLength(0);
    expect(uploads()).toHaveLength(2);
    expect(mocks.values.get(operationKey())).toMatchObject({ phase: 'complete', marker: OPERATION_MARKER, issueId: '500', issueKey: 'DEV-1' });
    expect(mocks.values.get('receipt-500')).toBeDefined();
    expect(mocks.asApp).not.toHaveBeenCalled();
  });

  it('keeps an unknown operation blocked without explicit recovery selection', async () => {
    unknownPublication();
    await expect(run('publish')).rejects.toThrow();
    expect(creates()).toHaveLength(0);
    expect(uploads()).toHaveLength(0);
  });

  it.each(['creating', 'rejected'])('does not adopt an issue for a %s operation', async phase => {
    unknownPublication(phase);
    await expect(run('publish', { ...input, recoverIssueKey: 'DEV-1' })).rejects.toThrow();
    expect(creates()).toHaveLength(0);
    expect(uploads()).toHaveLength(0);
    expect(mocks.values.get(operationKey())).not.toHaveProperty('issueId');
  });

  it('does not create or adopt an issue when recovery has no existing publication', async () => {
    await expect(run('publish', { ...input, recoverIssueKey: 'DEV-1' })).rejects.toThrow();
    expect(creates()).toHaveLength(0);
    expect(uploads()).toHaveLength(0);
  });

  it.each([
    ['project', () => { (recoveryIssue.fields as Record<string, unknown>).project = { id: '201' }; }],
    ['creator', () => { (recoveryIssue.fields as Record<string, unknown>).creator = { accountId: 'another-agent' }; }],
    ['missing creator', () => { delete (recoveryIssue.fields as Record<string, unknown>).creator; }],
    ['creation too early', () => { (recoveryIssue.fields as Record<string, unknown>).created = new Date(Date.now() - 301_000).toISOString(); }],
    ['creation too late', () => { (recoveryIssue.fields as Record<string, unknown>).created = new Date(Date.now() + 301_000).toISOString(); }],
    ['invalid creation time', () => { (recoveryIssue.fields as Record<string, unknown>).created = 'not-a-date'; }],
    ['missing publication property', () => { recoveryIssue.properties = {}; }],
    ['operation marker', () => { ((recoveryIssue.properties as Record<string, unknown>)['reproshare.publication'] as Record<string, unknown>).operation = 'different-marker'; }],
    ['fixture hash', () => { ((recoveryIssue.properties as Record<string, unknown>)['reproshare.publication'] as Record<string, unknown>).fixtureHash = sha256('different fixture'); }],
    ['profile', () => { ((recoveryIssue.properties as Record<string, unknown>)['reproshare.publication'] as Record<string, unknown>).profileId = 'precision'; }],
    ['version', () => { ((recoveryIssue.properties as Record<string, unknown>)['reproshare.publication'] as Record<string, unknown>).version = 2; }],
    ['string version', () => { ((recoveryIssue.properties as Record<string, unknown>)['reproshare.publication'] as Record<string, unknown>).version = '1'; }],
  ])('rejects recovery with mismatched %s', async (_name, corrupt) => {
    unknownPublication();
    (corrupt as () => void)();
    await expect(run('publish', { ...input, recoverIssueKey: 'DEV-1' })).rejects.toThrow();
    expect(creates()).toHaveLength(0);
    expect(uploads()).toHaveLength(0);
    expect(mocks.values.get(operationKey())).toMatchObject({ phase: 'unknown' });
    expect(mocks.values.get(operationKey())).not.toHaveProperty('issueId');
    expect(mocks.values.get('receipt-500')).toBeUndefined();
  });

  it.each(['BROWSE_PROJECTS', 'EDIT_ISSUES', 'CREATE_ATTACHMENTS'])('requires target issue permission %s before adopting', async permission => {
    unknownPublication();
    targetDeniedPermission = permission;
    await expect(run('publish', { ...input, recoverIssueKey: 'DEV-1' })).rejects.toThrow();
    expect(creates()).toHaveLength(0);
    expect(uploads()).toHaveLength(0);
    expect(mocks.values.get(operationKey())).not.toHaveProperty('issueId');
  });

  it('does not adopt a target issue the user cannot read', async () => {
    unknownPublication();
    targetDenied = true;
    await expect(run('publish', { ...input, recoverIssueKey: 'DEV-1' })).rejects.toThrow();
    expect(creates()).toHaveLength(0);
    expect(uploads()).toHaveLength(0);
    expect(mocks.values.get(operationKey())).not.toHaveProperty('issueId');
  });

  it('does not upload if the immutable recovery identity cannot be saved', async () => {
    unknownPublication();
    const normalSet = mocks.set.getMockImplementation()!;
    mocks.set.mockImplementation(async (key: string, value: unknown, options?: { keyPolicy?: string }) => {
      if (key === `${operationKey()}-recovery`) throw new Error('Recovery storage unavailable');
      return normalSet(key, value, options);
    });
    await expect(run('publish', { ...input, recoverIssueKey: 'DEV-1' })).rejects.toThrow();
    expect(creates()).toHaveLength(0);
    expect(uploads()).toHaveLength(0);
    expect(mocks.values.get(operationKey())).not.toHaveProperty('issueId');
  });

  it('uses a previously saved recovery identity when the main operation is still unknown', async () => {
    unknownPublication();
    mocks.values.set(`${operationKey()}-recovery`, recoveryClaim());
    await expect(run('getPublicationStatus', { reviewId: REVIEW_ID, projectId: '200' })).resolves.toEqual({ phase: 'created', marker: OPERATION_MARKER, issueKey: 'DEV-1' });
    await expect(run('publish')).resolves.toMatchObject({ key: 'DEV-1', reused: true });
    expect(creates()).toHaveLength(0);
    expect(uploads()).toHaveLength(2);
  });

  it('does not replace an already recovered identity with a different explicit key', async () => {
    unknownPublication();
    mocks.values.set(`${operationKey()}-recovery`, recoveryClaim());
    await expect(run('publish', { ...input, recoverIssueKey: 'DEV-2' })).rejects.toThrow();
    expect(creates()).toHaveLength(0);
    expect(uploads()).toHaveLength(0);
    expect(mocks.values.get(`${operationKey()}-recovery`)).toMatchObject({ issueId: '500', issueKey: 'DEV-1' });
  });

  it.each(['marker', 'createdAt'])('rejects an immutable recovery identity with a different %s', async field => {
    unknownPublication();
    mocks.values.set(`${operationKey()}-recovery`, { ...recoveryClaim(), [field]: field === 'marker' ? 'different-marker' : Date.now() - 1000 });
    await expect(run('publish')).rejects.toThrow();
    expect(creates()).toHaveLength(0);
    expect(uploads()).toHaveLength(0);
    expect(mocks.values.get(operationKey())).not.toHaveProperty('issueId');
  });

  it('allows only one target identity under concurrent recovery requests', async () => {
    unknownPublication();
    alternativeRecoveryIssue = { ...structuredClone(recoveryIssue), id: '501', key: 'DEV-2' };
    const results = await Promise.allSettled([
      run('publish', { ...input, recoverIssueKey: 'DEV-1' }),
      run('publish', { ...input, recoverIssueKey: 'DEV-2' }),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(creates()).toHaveLength(0);
    expect(uploads()).toHaveLength(2);
    expect(attachments).toHaveLength(2);
    const claimed = mocks.values.get(`${operationKey()}-recovery`) as { issueId: string };
    expect(attachments.every(file => file.issueId === claimed.issueId)).toBe(true);
  });
});

describe('publication status access', () => {
  const statusInput = { reviewId: REVIEW_ID, projectId: '200' };

  it('returns no publication when none exists and only its bounded public status when present', async () => {
    await expect(run('getPublicationStatus', statusInput)).resolves.toBeNull();
    unknownPublication();
    await expect(run('getPublicationStatus', statusInput)).resolves.toEqual({ phase: 'unknown', marker: OPERATION_MARKER });
    mocks.values.set(operationKey(), { phase: 'complete', marker: OPERATION_MARKER, createdAt: Date.now(), issueId: '500', issueKey: 'DEV-1', issueUrl: '/browse/DEV-1' });
    await expect(run('getPublicationStatus', statusInput)).resolves.toEqual({ phase: 'complete', marker: OPERATION_MARKER, issueKey: 'DEV-1' });
    expect(creates()).toHaveLength(0);
    expect(uploads()).toHaveLength(0);
  });

  it.each([
    { actor: actorKey('another-agent', context.cloudId) },
    { actor: actorKey(context.accountId, 'another-site') },
    { issueId: '101' },
    { createdAt: Date.now() - 2 * 60 * 60 * 1000 },
  ])('does not disclose status for an unrelated or expired review: %j', async overrides => {
    unknownPublication();
    saveReview(overrides);
    await expect(run('getPublicationStatus', statusInput)).rejects.toThrow();
    expect(creates()).toHaveLength(0);
    expect(uploads()).toHaveLength(0);
  });

  it('does not disclose another project publication through client input', async () => {
    unknownPublication();
    await expect(run('getPublicationStatus', { ...statusInput, projectId: '201' })).resolves.toBeNull();
  });

  it('rejects stale-source status requests as well as stale publications', async () => {
    unknownPublication();
    sourceUpdated = '2026-11-12T13:00:00.000Z';
    await expect(run('getPublicationStatus', statusInput)).rejects.toThrow();
    expect(creates()).toHaveLength(0);
    expect(uploads()).toHaveLength(0);
  });
});

describe('publish concurrency and uncertain outcomes', () => {
  it('creates one issue under concurrent publish requests', async () => {
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => run('publish')));
    expect(results.some(result => result.status === 'fulfilled')).toBe(true);
    expect(creates()).toHaveLength(1);
    expect(uploads()).toHaveLength(2);
    expect(attachments).toHaveLength(2);
  });

  it('does not repeat an issue creation whose response was lost', async () => {
    createMode = 'timeout';
    await expect(run('publish')).rejects.toThrow('Network response lost');
    createMode = 'normal';
    await expect(run('publish')).rejects.toThrow('unconfirmed');
    expect(creates()).toHaveLength(1);
    const opKey = publicationKey(actorKey(context.accountId, context.cloudId), '100', exampleRepro().fixtureHash, '200');
    expect(mocks.values.get(opKey)).toMatchObject({ phase: 'unknown' });
  });

  it('allows a corrected retry after an authoritative Jira creation rejection', async () => {
    createMode = 'rejected';
    await expect(run('publish')).rejects.toThrow('Jira rejected');
    createMode = 'normal';
    await expect(run('publish')).resolves.toMatchObject({ key: 'DEV-1' });
    expect(creates()).toHaveLength(2);
    expect(attachments).toHaveLength(2);
  });

  it('does not treat an HTTP creation timeout as proof that no issue was created', async () => {
    createMode = 'http-timeout';
    await expect(run('publish')).rejects.toThrow();
    createMode = 'normal';
    await expect(run('publish')).rejects.toThrow('unconfirmed');
    expect(creates()).toHaveLength(1);
  });

  it('recovers a committed upload by exact bytes without uploading it again', async () => {
    uploadMode = 'commit-then-timeout';
    await expect(run('publish')).rejects.toThrow('Engineering issue DEV-1 exists');
    await expect(run('publish')).resolves.toMatchObject({ key: 'DEV-1', reused: true });
    expect(creates()).toHaveLength(1);
    expect(uploads()).toHaveLength(2);
    expect(attachments).toHaveLength(2);
  });

  it('keeps an unconfirmed upload reserved when no matching attachment can be found', async () => {
    uploadMode = 'timeout-before-commit';
    await expect(run('publish')).rejects.toThrow('Engineering issue DEV-1 exists');
    uploadMode = 'normal';
    await expect(run('publish')).rejects.toThrow('still pending or could not be confirmed');
    expect(creates()).toHaveLength(1);
    expect(uploads()).toHaveLength(1);
  });

  it('does not release an upload reservation after an HTTP timeout', async () => {
    uploadMode = 'http-timeout';
    await expect(run('publish')).rejects.toThrow('Engineering issue DEV-1 exists');
    uploadMode = 'normal';
    await expect(run('publish')).rejects.toThrow('still pending or could not be confirmed');
    expect(creates()).toHaveLength(1);
    expect(uploads()).toHaveLength(1);
  });

  it('resumes a definitively denied upload on the existing issue', async () => {
    uploadMode = 'denied';
    await expect(run('publish')).rejects.toThrow('Engineering issue DEV-1 exists');
    uploadMode = 'normal';
    await expect(run('publish')).resolves.toMatchObject({ key: 'DEV-1', reused: true });
    expect(creates()).toHaveLength(1);
    expect(uploads()).toHaveLength(3);
  });
});

describe('read-only approved-fixture tool', () => {
  it('accepts the documented direct-function principal context without resolver-only cloudId fields', async () => {
    const functionContext = { principal: { accountId: context.accountId }, installContext: 'ari:cloud:jira::site-a' };
    await expect(getApprovedReproducer({ issueKey: 'DEV-1' }, functionContext as Parameters<typeof getApprovedReproducer>[1])).resolves.toMatchObject({ status: 'not_available' });
  });

  it('does not trust an issue marker without a private publication receipt', async () => {
    await expect(getApprovedReproducer({ issueKey: 'DEV-1', approved: true, fixtureJson: sourceSecret }, context)).resolves.toMatchObject({ status: 'not_available' });
    expect(mocks.request.mock.calls).toHaveLength(1);
  });

  it('checks the invoking user can read the target before looking up its receipt', async () => {
    targetDenied = true;
    await expect(getApprovedReproducer({ issueKey: 'DEV-1' }, context)).resolves.toEqual({ status: 'not_available', message: 'No approved package is available under your current access.' });
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.asApp).not.toHaveBeenCalled();
  });

  it('returns only receipt-approved synthetic files without reading the private source', async () => {
    await run('publish');
    mocks.request.mockClear();
    const output = await getApprovedReproducer({ issueKey: 'DEV-1' }, context);
    expect(output).toMatchObject({ status: 'approved_synthetic_example', fixtureJson: exampleRepro().fixtureJson, harnessCode: exampleRepro().harnessCode });
    expect(JSON.stringify(output)).not.toContain(sourceSecret);
    expect(JSON.stringify(output)).not.toContain('PRIVATE-7');
    expect(mocks.request.mock.calls.every(([path]) => !String(path).includes('/issue/100'))).toBe(true);
    expect(mocks.asApp).not.toHaveBeenCalled();
  });

  it('rejects modified attachment bytes despite a valid private receipt', async () => {
    await run('publish');
    const original = attachments[0];
    original.bytes = new TextEncoder().encode(sourceSecret);
    original.size = original.bytes.length;
    await expect(getApprovedReproducer({ issueKey: 'DEV-1' }, context)).rejects.toThrow('changed');
  });

  it('rejects a receipt attachment not attached to the visible target issue', async () => {
    await run('publish');
    const receipt = mocks.values.get('receipt-500') as Record<string, unknown>;
    receipt.fixtureAttachmentId = '900';
    receipt.fixtureHash = sha256(sourceSecret);
    mocks.request.mockClear();
    await expect(getApprovedReproducer({ issueKey: 'DEV-1' }, context)).rejects.toThrow('missing');
    expect(mocks.request.mock.calls.some(([path]) => String(path).includes('/attachment/content/900'))).toBe(false);
  });
});

describe('AI resolver access and binding', () => {
  it.each([
    ['startAiInvestigation', investigationInput],
    ['getAiJob', { jobId: INVESTIGATION_ID }],
    ['startAiBrief', { reviewId: REVIEW_ID, consentToAi: true }],
    ['prepare', preparationInput],
    ['publish', { ...input, aiBriefJobId: BRIEF_JOB_ID }],
  ])('does not start, poll, or use AI through %s when source access is denied', async (name, payload) => {
    deniedPermission = 'BROWSE_PROJECTS';
    await expect(run(name as string, payload)).rejects.toThrow('view and edit');
    for (const fn of Object.values(mocks.ai)) expect(fn).not.toHaveBeenCalled();
    expect(mocks.prepareRepro).not.toHaveBeenCalled();
    expect(creates()).toHaveLength(0);
    expect(mocks.asApp).not.toHaveBeenCalled();
  });

  it('stops source HTTP denial before starting or polling an AI job', async () => {
    const normalRequest = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation(async (path: string, options?: { method?: string; body?: BodyInit }) => {
      if (path.startsWith('/rest/api/3/issue/100?')) return json({}, 403);
      return normalRequest(path, options);
    });
    await expect(run('startAiInvestigation', investigationInput)).rejects.toThrow('Jira 403');
    await expect(run('getAiJob', { jobId: INVESTIGATION_ID })).rejects.toThrow('Jira 403');
    expect(mocks.ai.startAiInvestigation).not.toHaveBeenCalled();
    expect(mocks.ai.getAiJob).not.toHaveBeenCalled();
  });

  it('delegates investigation with trusted actor and source context rather than payload identity', async () => {
    await expect(run('startAiInvestigation', { ...investigationInput, actor: 'forged', issue: { id: '999' }, context: { accountId: 'forged' }, sourceHash: 'forged-hash' })).resolves.toEqual({ jobId: INVESTIGATION_ID });
    expect(mocks.ai.startAiInvestigation).toHaveBeenCalledExactlyOnceWith({
      actor: actorKey(context.accountId, context.cloudId),
      issue: expect.objectContaining({ id: '100', key: 'PRIVATE-7', updated: UPDATED }),
      ...investigationInput,
    });
    expect(mocks.asApp).not.toHaveBeenCalled();
  });

  it.each([false, 'true', 1, undefined])('never upgrades investigation consent %s into a true opt-in', async consentToAi => {
    await run('startAiInvestigation', { ...investigationInput, consentToAi });
    expect(mocks.ai.startAiInvestigation).toHaveBeenCalledWith(expect.objectContaining({ consentToAi: false }));
  });

  it('delegates polling against the current trusted source and actor', async () => {
    await run('getAiJob', { jobId: INVESTIGATION_ID, actor: 'forged', issueId: '999' });
    expect(mocks.ai.getAiJob).toHaveBeenCalledExactlyOnceWith({ actor: actorKey(context.accountId, context.cloudId), issue: expect.objectContaining({ id: '100', updated: UPDATED }), jobId: INVESTIGATION_ID });
  });

  it.each(['../job', '', 'b35939e6-1c29-1d81-9b18-6d727fe5c904', 123, null])('rejects malformed job identifiers %s before AI delegation', async malformed => {
    await expect(run('getAiJob', { jobId: malformed })).rejects.toThrow();
    await expect(run('prepare', { ...preparationInput, investigationId: malformed })).rejects.toThrow();
    await expect(run('publish', { ...input, aiBriefJobId: malformed })).rejects.toThrow();
    for (const fn of Object.values(mocks.ai)) expect(fn).not.toHaveBeenCalled();
    expect(mocks.prepareRepro).not.toHaveBeenCalled();
    expect(creates()).toHaveLength(0);
  });

  it('binds a brief request to the checked stored review and ignores client-supplied artifacts', async () => {
    await run('startAiBrief', { reviewId: REVIEW_ID, consentToAi: true, repro: { fixtureJson: sourceSecret }, actor: 'forged', issueId: '999' });
    expect(mocks.ai.startAiBrief).toHaveBeenCalledExactlyOnceWith({
      actor: actorKey(context.accountId, context.cloudId), issue: expect.objectContaining({ id: '100', updated: UPDATED }),
      reviewId: REVIEW_ID, repro: exampleRepro(), consentToAi: true,
    });
  });

  it.each([
    { actor: actorKey('another-agent', context.cloudId) },
    { issueId: '101' },
    { createdAt: Date.now() - 2 * 60 * 60 * 1000 },
  ])('does not start a brief for an unrelated or expired stored review: %j', async overrides => {
    saveReview(overrides);
    await expect(run('startAiBrief', { reviewId: REVIEW_ID, consentToAi: true })).rejects.toThrow('expired or belongs');
    expect(mocks.ai.startAiBrief).not.toHaveBeenCalled();
  });

  it('does not start a brief after the source changes', async () => {
    sourceUpdated = '2026-11-12T13:00:00.000Z';
    await expect(run('startAiBrief', { reviewId: REVIEW_ID, consentToAi: true })).rejects.toThrow('changed after');
    expect(mocks.ai.startAiBrief).not.toHaveBeenCalled();
  });

  it('requires successful investigation assertion before enabling broader generation', async () => {
    mocks.ai.assertInvestigation.mockRejectedValueOnce(new Error('Investigation does not match actor, source hash, or candidate'));
    await expect(run('prepare', { ...preparationInput, actor: 'forged', sourceHash: 'forged-hash' })).rejects.toThrow('does not match');
    expect(mocks.ai.assertInvestigation).toHaveBeenCalledExactlyOnceWith({
      actor: actorKey(context.accountId, context.cloudId), issue: expect.objectContaining({ id: '100', updated: UPDATED }),
      investigationId: INVESTIGATION_ID, sourceJson: investigationSource, candidateId: investigationCandidate.id,
    });
    expect(mocks.prepareRepro).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
    const result = await run('prepare', preparationInput);
    expect(result).toMatchObject({ repro: { profileId: 'precision', comparison: { expected: 2, source: 1, synthetic: 1, fixed: 2 } } });
    expect(mocks.prepareRepro).toHaveBeenCalledExactlyOnceWith(preparationInput, { allowAnyStringFields: true });
    expect(mocks.ai.assertInvestigation.mock.invocationCallOrder[1]).toBeLessThan(mocks.prepareRepro.mock.invocationCallOrder[0]);
  });

  it('cannot bypass investigation validation with a client broad-generation flag', async () => {
    const { investigationId: _investigationId, ...manualInput } = preparationInput;
    await expect(run('prepare', { ...manualInput, allowAnyStringFields: true, options: { allowAnyStringFields: true } })).rejects.toThrow('no longer present');
    expect(mocks.ai.assertInvestigation).not.toHaveBeenCalled();
    expect(mocks.prepareRepro).toHaveBeenCalledExactlyOnceWith(manualInput, { allowAnyStringFields: false });
    expect(mocks.set).not.toHaveBeenCalled();
  });
});

describe('reviewed AI briefing publication boundary', () => {
  it('ignores injected client brief and private investigation content without an approved job ID', async () => {
    await run('publish', { ...input, aiBrief: { ...approvedBrief(), summary: sourceSecret }, aiInvestigation: sourceSecret, explanation: sourceSecret });
    expect(mocks.ai.getAiBriefForPublish).not.toHaveBeenCalled();
    expect(JSON.stringify(JSON.parse(creates()[0][1].body as string).fields.description)).not.toContain('Reviewed AI investigation brief');
    expect(JSON.stringify(creates()[0])).not.toContain(sourceSecret);
    expect(mocks.values.get('receipt-500')).not.toHaveProperty('aiBrief');
    expect(mocks.values.get(operationKey())).not.toHaveProperty('aiBrief');
  });

  it('publishes only the validated stored brief and carries it into the approval receipt', async () => {
    const brief = approvedBrief();
    await expect(run('publish', { ...input, aiBriefJobId: BRIEF_JOB_ID, aiBrief: { summary: sourceSecret }, investigation: { explanation: sourceSecret } })).resolves.toMatchObject({ key: 'DEV-1', aiBriefIncluded: true });
    expect(mocks.ai.getAiBriefForPublish).toHaveBeenCalledExactlyOnceWith({
      actor: actorKey(context.accountId, context.cloudId), issue: expect.objectContaining({ id: '100', updated: UPDATED }), reviewId: REVIEW_ID, repro: exampleRepro(), jobId: BRIEF_JOB_ID,
    });
    const description = JSON.parse(creates()[0][1].body as string).fields.description;
    expect(JSON.stringify(description)).toContain(brief.summary);
    expect(JSON.stringify(description)).toContain('Reviewed AI investigation brief');
    expect(JSON.stringify(description)).toContain(exampleRepro().fixtureHash);
    expect(JSON.stringify(description)).toContain('Expected: 1 events. Example handler with synthetic data: 2. Corrected example handler: 1.');
    expect(JSON.stringify(description)).not.toContain(sourceSecret);
    expect(JSON.stringify(description)).not.toContain('PRIVATE-7');
    expect(mocks.values.get('receipt-500')).toMatchObject({ aiBrief: brief });
    expect(mocks.values.get(operationKey())).toMatchObject({ aiBrief: brief, phase: 'complete' });
  });

  it('does not reserve or publish when the brief binding check fails', async () => {
    mocks.ai.getAiBriefForPublish.mockRejectedValueOnce(new Error('Brief belongs to another fixture or review'));
    await expect(run('publish', { ...input, aiBriefJobId: BRIEF_JOB_ID })).rejects.toThrow('another fixture');
    expect(reservations()).toHaveLength(0);
    expect(creates()).toHaveLength(0);
    expect(uploads()).toHaveLength(0);
    expect(mocks.values.get('receipt-500')).toBeUndefined();
  });

  it.each(['partial', 'complete'])('preserves the original immutable brief when a %s publication is reused with a different AI job', async firstPhase => {
    const firstBrief = approvedBrief('Original approved briefing');
    mocks.ai.getAiBriefForPublish.mockResolvedValue(firstBrief);
    if (firstPhase === 'partial') {
      uploadMode = 'denied';
      await expect(run('publish', { ...input, aiBriefJobId: BRIEF_JOB_ID })).rejects.toThrow('Engineering issue DEV-1 exists');
    } else await run('publish', { ...input, aiBriefJobId: BRIEF_JOB_ID });
    expect(mocks.values.get(operationKey())).toMatchObject({ phase: firstPhase, aiBrief: firstBrief });
    uploadMode = 'normal';
    const replacement = approvedBrief('A different briefing that must not replace the approved snapshot');
    mocks.ai.getAiBriefForPublish.mockResolvedValue(replacement);
    await expect(run('publish', { ...input, aiBriefJobId: OTHER_BRIEF_JOB_ID })).resolves.toMatchObject({ key: 'DEV-1', reused: true, aiBriefIncluded: true });
    expect(mocks.ai.getAiBriefForPublish).toHaveBeenLastCalledWith(expect.objectContaining({ jobId: OTHER_BRIEF_JOB_ID }));
    expect(creates()).toHaveLength(1);
    expect(JSON.stringify(creates()[0])).toContain(firstBrief.title);
    expect(JSON.stringify(creates()[0])).not.toContain(replacement.title);
    expect(mocks.values.get(operationKey())).toMatchObject({ phase: 'complete', aiBrief: firstBrief });
    expect(mocks.values.get('receipt-500')).toMatchObject({ aiBrief: firstBrief });
    expect(attachments).toHaveLength(2);
  });

  it('does not add a later brief to a publication originally approved without one', async () => {
    await run('publish');
    const result = await run('publish', { ...input, aiBriefJobId: BRIEF_JOB_ID });
    expect(result).not.toHaveProperty('aiBriefIncluded');
    expect(creates()).toHaveLength(1);
    expect(mocks.values.get(operationKey())).not.toHaveProperty('aiBrief');
    expect(mocks.values.get('receipt-500')).not.toHaveProperty('aiBrief');
  });

  it('retains the original brief when a partial publication resumes without another AI job', async () => {
    uploadMode = 'denied';
    await expect(run('publish', { ...input, aiBriefJobId: BRIEF_JOB_ID })).rejects.toThrow('Engineering issue DEV-1 exists');
    uploadMode = 'normal';
    mocks.ai.getAiBriefForPublish.mockClear();
    await expect(run('publish')).resolves.toMatchObject({ key: 'DEV-1', reused: true, aiBriefIncluded: true });
    expect(mocks.ai.getAiBriefForPublish).not.toHaveBeenCalled();
    expect(mocks.values.get('receipt-500')).toMatchObject({ aiBrief: approvedBrief() });
    expect(creates()).toHaveLength(1);
  });

  it('returns the reviewed brief through MCP only with the integrity-checked approved package', async () => {
    await run('publish', { ...input, aiBriefJobId: BRIEF_JOB_ID });
    mocks.request.mockClear();
    const output = await getApprovedReproducer({ issueKey: 'DEV-1', aiBrief: { summary: sourceSecret } }, context);
    expect(output).toMatchObject({ status: 'approved_synthetic_example', aiBrief: approvedBrief(), fixtureJson: exampleRepro().fixtureJson, harnessCode: exampleRepro().harnessCode });
    expect(JSON.stringify(output)).not.toContain(sourceSecret);
    expect(JSON.stringify(output)).not.toContain('PRIVATE-7');
    expect(mocks.request.mock.calls.every(([path]) => !String(path).includes('/issue/100'))).toBe(true);
  });

  it('does not disclose a stored brief when the invoking user loses target issue access', async () => {
    await run('publish', { ...input, aiBriefJobId: BRIEF_JOB_ID });
    targetDenied = true;
    mocks.get.mockClear();
    await expect(getApprovedReproducer({ issueKey: 'DEV-1' }, context)).resolves.toEqual({ status: 'not_available', message: 'No approved package is available under your current access.' });
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.asApp).not.toHaveBeenCalled();
  });

  it('does not return a brief when an approved attachment content read is denied', async () => {
    await run('publish', { ...input, aiBriefJobId: BRIEF_JOB_ID });
    const deniedAttachmentId = attachments[1].id;
    const normalRequest = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation(async (path: string, options?: { method?: string; body?: BodyInit }) => {
      if (path === `/rest/api/3/attachment/content/${deniedAttachmentId}?redirect=false`) return json({}, 403);
      return normalRequest(path, options);
    });
    await expect(getApprovedReproducer({ issueKey: 'DEV-1' }, context)).rejects.toThrow('unavailable under your permissions');
    expect(mocks.asApp).not.toHaveBeenCalled();
  });

  it.each(['missing', 'modified'])('does not return the brief when an approved attachment is %s', async failure => {
    await run('publish', { ...input, aiBriefJobId: BRIEF_JOB_ID });
    if (failure === 'missing') attachments.splice(0, 1);
    else {
      attachments[1].bytes = new TextEncoder().encode('tampered synthetic harness');
      attachments[1].size = attachments[1].bytes.length;
    }
    await expect(getApprovedReproducer({ issueKey: 'DEV-1' }, context)).rejects.toThrow(failure === 'missing' ? 'missing' : 'changed');
  });
});

describe('private review navigation and explicit renewal', () => {
  it('lists only the current actor and source, and never returns original data or other reviews', async () => {
    saveReview();
    const otherId = 'd15ad229-6b13-4b13-bff6-9cb26076e600';
    mocks.values.set(`review-${otherId}`, { actor: 'another-actor', issueId: '100', sourceUpdated: UPDATED, createdAt: Date.now(), repro: { ...exampleRepro(), title: 'OTHER_ACTOR_PRIVATE' } });
    mocks.values.set(`recent-${actorKey(context.accountId, context.cloudId)}-100`, [REVIEW_ID, otherId, '../invalid']);
    const rows = await run('getRecentReviews');
    expect(rows).toEqual([expect.objectContaining({ reviewId: REVIEW_ID, evidenceLevel: 'prepared', expired: false, stale: false })]);
    expect(JSON.stringify(rows)).not.toContain('OTHER_ACTOR_PRIVATE');
    expect(JSON.stringify(rows)).not.toContain(exampleRepro().sourceHash);
    expect(creates()).toHaveLength(0); expect(uploads()).toHaveLength(0);
  });
  it('resumes as a new review while leaving the old review and Jira unchanged', async () => {
    saveReview();
    const prior = structuredClone(mocks.values.get(`review-${REVIEW_ID}`));
    const resumed = await run('resumeReview', { reviewId: REVIEW_ID }) as ReviewDraft;
    expect(resumed.reviewId).not.toBe(REVIEW_ID);
    expect(resumed.repro.fixtureJson).toBe(exampleRepro().fixtureJson);
    expect(mocks.values.get(`review-${REVIEW_ID}`)).toEqual(prior);
    expect(creates()).toHaveLength(0); expect(uploads()).toHaveLength(0); expect(mocks.asApp).not.toHaveBeenCalled();
  });
  it('requires explicit renewal after an hour and still refuses stale or cross-actor records', async () => {
    saveReview({ createdAt: Date.now() - 2 * 60 * 60 * 1000 });
    await expect(run('resumeReview', { reviewId: REVIEW_ID })).rejects.toThrow('expired');
    await expect(run('resumeReview', { reviewId: REVIEW_ID, renewExpired: true })).resolves.toMatchObject({ repro: { fixtureHash: exampleRepro().fixtureHash } });
    saveReview({ createdAt: Date.now() - 2 * 60 * 60 * 1000, sourceUpdated: 'old-source-revision' });
    await expect(run('resumeReview', { reviewId: REVIEW_ID, renewExpired: true })).rejects.toThrow('source issue changed');
    saveReview({ actor: 'other', createdAt: Date.now() - 2 * 60 * 60 * 1000 });
    await expect(run('resumeReview', { reviewId: REVIEW_ID, renewExpired: true })).rejects.toThrow();
    expect(creates()).toHaveLength(0);
  });
});
