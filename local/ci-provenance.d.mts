export interface CiJob {
  provider: 'github-actions' | 'declared-local';
  repository: string;
  commit: string;
  workflow: string;
  runId: string;
  runAttempt: number;
  jobId: string;
}
export interface CiBuild { scope: 'declared-affected-application-files'; revision: string; sha256: string; }
export interface CiStatement {
  version: 1;
  kind: 'reproshare-ci-public-artifacts';
  fixtureHash: string;
  applicationRunnerHash: string;
  testSpecHash: string;
  publicReceiptHash: string;
  build: CiBuild;
  job: CiJob;
  executionEvidence: 'local-self-report-not-upgraded';
}
export interface CiTrustPolicy {
  version: 1;
  kind: 'reproshare-ci-trust-policy';
  keyId: string;
  publicKeyPem: string;
  expectedJob: CiJob;
  expectedBuild: CiBuild;
}
export interface CiSignedStatement { version: 1; kind: 'reproshare-ci-signed-public-artifacts'; algorithm: 'Ed25519'; keyId: string; statement: CiStatement; signature: string; }
export function validateCiPublicReceipt(value: unknown): Record<string, unknown>;
export function parseCiJob(value: unknown): CiJob;
export function declaredBuildForSpec(value: unknown): CiBuild;
export function createCiStatement(input: { publicReceipt: unknown; fixtureBytes: Uint8Array | string; runnerBytes: Uint8Array | string; testSpec: unknown; job: unknown }): CiStatement;
export function signCiStatement(statement: CiStatement, options: { keyId: string; privateKeyPem: string }): CiSignedStatement;
export function parseCiTrustPolicy(value: unknown): CiTrustPolicy;
export function verifyCiStatement(envelope: unknown, options: { trustPolicy: unknown; expectedStatement: CiStatement }): { status: string; execution: 'not-attested'; providerIdentity: 'not-verified-by-this-tool'; [key: string]: unknown };
export function parseCiJson(bytes: string | Uint8Array, maxBytes?: number): unknown;
