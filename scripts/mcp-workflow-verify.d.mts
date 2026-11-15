export interface WorkflowProbeOptions {
  authenticated: boolean; authorize: boolean; sdkSession: boolean; noOpen: boolean; validateOnly: boolean; pauseForTargetDenial: boolean;
  allowlist: string; issueKey: string; denyIssueKey: string; unapprovedIssueKey?: string;
  fixtureSha256: string; runnerSha256: string; actorSha256: string; output: string; artifacts: string;
}
export function parseWorkflowProbeOptions(args: string[]): WorkflowProbeOptions;
export function validateWorkflowProbePolicy(value: unknown, input: Pick<WorkflowProbeOptions, 'issueKey' | 'denyIssueKey' | 'unapprovedIssueKey'>): Record<string, unknown>;
export function approvedWorkflowResult(value: unknown, expected: Pick<WorkflowProbeOptions, 'issueKey' | 'fixtureSha256' | 'runnerSha256'>): { summary: Record<string, unknown>; artifacts?: Record<string, unknown> };
export function workflowDenialResult(value: unknown): { verified: boolean; category: string; reason?: string };
export function approvedTargetDenialResult(value: unknown): { verified: boolean; category: string; reason?: string; noArtifactFieldsReturned: boolean };
export function waitForTargetRevocation(stream: NodeJS.ReadableStream & { readableEnded?: boolean; destroyed?: boolean; pause?(): unknown; resume?(): unknown }, timeoutMs?: number): Promise<void>;
export function receiverIdentityMatches(profile: unknown, expectedHash: string): boolean;
export function runWorkflowProbe(args: string[]): Promise<void>;
