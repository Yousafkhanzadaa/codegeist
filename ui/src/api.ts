import type {
  ApplicationCaseId, IssueContext, IssueTypeChoice, ProfileId, ProjectChoice,
  AiInvestigationInput, AiJobResult, AiJobStarted, PrepareInput,
  PublicationStatus, PublishInput, PublishedIssue, RequiredField, ReviewDraft, RecentReview, ScanResult,
} from '../../src/shared/contracts';

export interface Sample {
  id: ProfileId | ApplicationCaseId;
  title: string;
  description: string;
  sourceJson: string;
  applicationCaseId?: ApplicationCaseId;
  expectedBehavior?: string;
  observedBehavior?: string;
}

export const isPreview = ['127.0.0.1', 'localhost', '[::1]'].includes(window.location.hostname)
  && new URLSearchParams(window.location.search).get('demo') === '1';

const previewContext: IssueContext = {
  id: 'preview-10001', key: 'SUP-142', summary: 'A valid customer invoice import fails',
  projectName: 'Customer support · simulated context', updated: '2026-11-12T07:00:00.000Z', attachments: [],
};

// No metadata argument is sent. Forge Bridge returns the resolver body directly
// in that form; its current declaration also includes the metadata envelope.
async function call<T>(name: string, payload?: Record<string, unknown>): Promise<T> {
  // The bridge throws during module loading outside Atlassian. A local preview
  // deliberately never establishes that connection.
  const { invoke } = await import('@forge/bridge');
  return invoke<T>(name, payload) as Promise<T>;
}

async function local<T>(name: 'samples' | 'scan' | 'prepare' | 'import-local' | 'import-workflow' | 'recent' | 'resume', payload?: Record<string, unknown>): Promise<T> {
  const response = await fetch(`/__reproshare/${name}`, {
    method: payload ? 'POST' : 'GET',
    ...(payload ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) } : {}),
  });
  const contentType = response.headers.get('Content-Type') ?? '';
  if (!contentType.includes('application/json')) throw new Error('The local engine is unavailable. Start ReproShare with npm run dev and open its loopback address with ?demo=1.');
  const result: unknown = await response.json();
  if (!response.ok) {
    const detail = result && typeof result === 'object' && 'error' in result ? String(result.error) : 'The local check could not be completed.';
    throw new Error(detail);
  }
  return result as T;
}

export const api = {
  getContext: (): Promise<IssueContext> => isPreview ? Promise.resolve(previewContext) : call<IssueContext>('getContext'),
  getSamples: (): Promise<Sample[]> => isPreview ? local<Sample[]>('samples') : call<Sample[]>('getSamples'),
  scan: (input: { sourceJson: string }): Promise<ScanResult> => isPreview ? local<ScanResult>('scan', input) : call<ScanResult>('scan', input),
  prepare: (input: PrepareInput): Promise<ReviewDraft> => isPreview ? local<ReviewDraft>('prepare', { ...input }) : call<ReviewDraft>('prepare', { ...input }),
  importLocalVerification: (input: { reviewId: string; reportJson: string }): Promise<ReviewDraft> => isPreview ? local<ReviewDraft>('import-local', input) : call<ReviewDraft>('importLocalVerification', input),
  importLocalWorkflow: (input: { packageJson: string }): Promise<ReviewDraft> => isPreview ? local<ReviewDraft>('import-workflow', input) : call<ReviewDraft>('importLocalWorkflow', input),
  getRecentReviews: (): Promise<RecentReview[]> => isPreview ? local<RecentReview[]>('recent') : call<RecentReview[]>('getRecentReviews'),
  resumeReview: (input: { reviewId: string; renewExpired?: boolean }): Promise<ReviewDraft> => isPreview ? local<ReviewDraft>('resume', input) : call<ReviewDraft>('resumeReview', input),
  startAiInvestigation: (input: AiInvestigationInput): Promise<AiJobStarted> => isPreview
    ? Promise.reject(new Error('AI is unavailable in local preview. Use the installed Jira panel for Atlassian-hosted AI. Manual checks work here.'))
    : call<AiJobStarted>('startAiInvestigation', { ...input }),
  getAiJob: (input: { jobId: string }): Promise<AiJobResult> => isPreview
    ? Promise.reject(new Error('AI jobs are unavailable in local preview.'))
    : call<AiJobResult>('getAiJob', input),
  startAiBrief: (input: { reviewId: string; consentToAi: boolean }): Promise<AiJobStarted> => isPreview
    ? Promise.reject(new Error('AI briefs are unavailable in local preview. Your verified artifacts remain available.'))
    : call<AiJobStarted>('startAiBrief', input),
  getProjects: (): Promise<ProjectChoice[]> => isPreview
    ? Promise.resolve([{ id: 'preview-dev', key: 'DEV', name: 'Product engineering (simulated)' }, { id: 'preview-qa', key: 'QA', name: 'Quality engineering (simulated)' }])
    : call<ProjectChoice[]>('getProjects'),
  getIssueTypes: (input: { projectId: string }): Promise<IssueTypeChoice[]> => isPreview
    ? Promise.resolve([{ id: 'preview-bug', name: 'Bug', description: 'A problem to investigate and resolve' }, { id: 'preview-task', name: 'Task', description: 'A unit of work' }])
    : call<IssueTypeChoice[]>('getIssueTypes', input),
  getFields: (input: { projectId: string; issueTypeId: string }): Promise<RequiredField[]> => isPreview
    ? Promise.resolve([{ id: 'preview-component', name: 'Component', type: 'option', choices: [{ id: 'importer', label: 'Data importer' }, { id: 'api', label: 'API' }] }])
    : call<RequiredField[]>('getFields', input),
  readAttachment: (input: { attachmentId: string }): Promise<{ text: string }> => call<{ text: string }>('readAttachment', input),
  getPublicationStatus: (input: { reviewId: string; projectId: string }): Promise<PublicationStatus | null> => isPreview
    ? Promise.resolve(null)
    : call<PublicationStatus | null>('getPublicationStatus', input),
  publish: (input: PublishInput): Promise<PublishedIssue> => isPreview
    ? Promise.resolve({ key: 'PREVIEW-1', url: '', reused: false })
    : call<PublishedIssue>('publish', { ...input }),
};

export function openLink(url: string) {
  const safeBrowsePath = /^\/browse\/[A-Z][A-Z0-9_]*-[1-9]\d*$/.test(url);
  if (!safeBrowsePath && !/^https:\/\//i.test(url)) return;
  if (isPreview) window.open(url, '_blank', 'noopener,noreferrer');
  else void import('@forge/bridge').then(({ router }) => router.open(url));
}
