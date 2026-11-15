import type { InputContract } from '../domain/input-contract';
import type { LocalVerificationEvidence } from '../../local/protocol.mjs';
export type { LocalVerificationEvidence } from '../../local/protocol.mjs';

export type ProfileId = 'precision' | 'unicode' | 'duplicates' | 'diacritics' | 'application';
export type ApplicationCaseId = 'hermes-integer-coercion' | 'es-toolkit-deburr';

/** Public, predeclared identity of the application check. Commands stay local. */
export interface VerificationSpec {
  version: 1;
  id: string;
  assertionId: string;
  failureKind: string;
  failureSite?: string;
  affected: { revision: string; files: Array<{ path: string; sha256: string }> };
  fixed?: { revision: string; files: Array<{ path: string; sha256: string }> };
}

/** Public receipt has no private-source/config/command commitments. */
export type PublicVerificationEvidence = Omit<LocalVerificationEvidence, 'sourceHash' | 'configurationHash' | 'oracleHash' | 'kind' | 'sourceKind'> & {
  kind: 'reproshare-public-verification';
  sourceKind: 'private-original-checked-locally';
  bindingId: string;
};

export interface ApplicationCase {
  id: ApplicationCaseId;
  title: string;
  issueUrl: string;
  fixUrl: string;
  affectedRevision: string;
  proposedFixRevision: string;
  entrypoint: string;
  inputContract: string;
  requirements: string[];
  scope: string;
  status: 'runner-ready';
}

export interface Candidate {
  id: string;
  profileId: ProfileId;
  title: string;
  description: string;
  paths: string[];
  fieldName: string;
  occurrenceCount: number;
}

export interface ScanResult {
  candidates: Candidate[];
  warnings: string[];
  valueCount: number;
  sourceHash: string;
}

export interface ReproCheck {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface HandlerComparison {
  label: string;
  expected: number;
  source: number;
  ordinary: number;
  synthetic: number;
  fixed: number;
  unit: string;
}

export interface PreparedRepro {
  version: 1;
  profileId: ProfileId;
  title: string;
  sourceHash: string;
  fixtureHash: string;
  fixtureJson: string;
  selectedPaths?: string[];
  ordinaryJson: string;
  checks: ReproCheck[];
  comparison: HandlerComparison;
  transformations: Array<{ path: string; rule: string }>;
  changedValueCount: number;
  limits: string[];
  reportMarkdown: string;
  harnessCode: string;
  applicationCase?: ApplicationCase;
  inputContract?: InputContract;
  inputContractHash?: string;
  ordinaryHash?: string;
  configurationHash?: string;
  bindingId?: string;
  configurationOrigin?: 'forge-prepared' | 'local-workflow';
  verificationSpec?: VerificationSpec;
  testSpecHash?: string;
  localVerification?: LocalVerificationEvidence;
  publicVerification?: PublicVerificationEvidence;
  workflowSummary?: { profileId: string; attempts: number; [key: string]: unknown };
}

export interface PrepareInput {
  sourceJson: string;
  candidateId: string;
  seed?: string;
  investigationId?: string;
  applicationCaseId?: ApplicationCaseId;
  inputContract?: string;
  verificationSpec?: VerificationSpec;
}

export interface SourceAttachment {
  id: string;
  filename: string;
  size: number;
  mimeType: string;
}

export interface IssueContext {
  id: string;
  key: string;
  summary: string;
  projectName: string;
  updated: string;
  attachments: SourceAttachment[];
}

export interface ProjectChoice {
  id: string;
  key: string;
  name: string;
}

export interface IssueTypeChoice {
  id: string;
  name: string;
  description: string;
}

export interface RequiredField {
  id: string;
  name: string;
  type: 'string' | 'number' | 'date' | 'option' | 'options' | 'unsupported';
  choices?: Array<{ id: string; label: string }>;
}

export interface ReviewDraft {
  reviewId: string;
  repro: PreparedRepro;
  sourceIssue: IssueContext;
}

export interface RecentReview {
  reviewId: string;
  title: string;
  createdAt: number;
  fixtureHash: string;
  evidenceLevel: 'prepared' | 'failure-reproduced' | 'fix-validated';
  expired: boolean;
  stale: boolean;
}

export interface PublishInput {
  reviewId: string;
  projectId: string;
  issueTypeId: string;
  summary: string;
  extraFields: Record<string, unknown>;
  includeSourceReference: boolean;
  confirmedReview: boolean;
  recoverIssueKey?: string;
  aiBriefJobId?: string;
}

export interface PublicationStatus {
  phase: string;
  marker: string;
  issueKey?: string;
}

export interface PublishedIssue {
  key: string;
  url: string;
  reused: boolean;
  aiBriefIncluded?: boolean;
}

export type AiOutcome = 'recommended' | 'relevance_unconfirmed' | 'needs_clarification' | 'unsupported';

export interface AiInvestigation {
  investigationId: string;
  outcome: AiOutcome;
  recommendedCandidateId: string | null;
  title: string;
  explanation: string;
  assumption: string;
  questions: string[];
  nextSteps: string[];
  confidence: 'high' | 'medium' | 'low';
  candidates: Candidate[];
  model: string;
}

export interface AiBrief {
  fixtureHash: string;
  title: string;
  summary: string;
  reproductionSteps: string[];
  investigationAreas: string[];
  acceptanceCriteria: string[];
  caution: string;
  model: string;
  planningMode?: 'schema-selection';
  selectedChecks?: string[];
}

export interface AiInvestigationInput {
  sourceJson: string;
  expectedBehavior: string;
  observedBehavior: string;
  consentToAi: boolean;
}

export interface AiJobStarted { jobId: string; }

export interface AiJobResult {
  jobId: string;
  kind: 'investigation' | 'brief';
  status: 'queued' | 'running' | 'complete' | 'failed';
  investigation?: AiInvestigation;
  brief?: AiBrief;
  error?: string;
}
