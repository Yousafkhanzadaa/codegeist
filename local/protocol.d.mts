export type MatrixName = 'original' | 'ordinary' | 'synthetic' | 'fixedOriginal' | 'fixedOrdinary' | 'fixedSynthetic';
export interface OracleCell {
  outcome: 'pass' | 'fail' | 'error';
  matchedExpected: boolean;
  assertionId?: string;
  failureKind?: string;
  failureSite?: string;
  errorCode?: string;
}
export interface AdapterBinding {
  revision: string;
  files: Array<{ path: string; sha256: string }>;
}
export interface VerificationSpec {
  version: 1;
  id: string;
  assertionId: string;
  failureKind: string;
  failureSite?: string;
  affected: AdapterBinding;
  fixed?: AdapterBinding;
}
export interface LocalVerificationEvidence {
  version: 1;
  kind: 'reproshare-local-verification';
  sourceKind: 'provided-local-source';
  configurationHash: string;
  contractHash: string;
  oracleHash: string;
  sourceHash: string;
  ordinaryHash: string;
  fixtureHash: string;
  runner: { revision: string; sha256: string; nodeVersion: string };
  adapters: { affected: AdapterBinding; fixed?: AdapterBinding };
  assertionId: string;
  failureKind: string;
  failureSite?: string;
  testSpecHash?: string;
  repetitions: number;
  ordinaryControl: 'hides-failure' | 'preserves-failure' | 'different-failure' | 'invalid' | 'inconclusive';
  inputValidity: { original: boolean; ordinary: boolean; synthetic: boolean };
  matrix: Partial<Record<MatrixName, OracleCell>>;
  verdict: 'verified' | 'rejected';
  evidenceLevel?: 'failure-reproduced' | 'fix-validated';
  failures: string[];
  scope: 'local-self-report-declared-files-only';
  evidenceHash: string;
}
export interface OracleAdapter {
  revision: string;
  command: string[];
  files: Array<{ path: string; sha256: string }>;
}
export interface OracleConfiguration {
  version: 1;
  id: string;
  assertionId: string;
  failureKind: string;
  failureSite?: string;
  affected: OracleAdapter;
  fixed?: OracleAdapter;
  limits?: { timeoutMs?: number; maxOutputBytes?: number; repetitions?: number; maxDurationMs?: number };
}
export interface VerificationOptions {
  packagePath?: string;
  contractPath?: string;
  oraclePath: string;
  sourcePath: string;
  ordinaryPath?: string;
  fixturePath?: string;
  cwd: string;
  configurationHash?: string;
  allowCommand: boolean;
}
export const RUNNER_REVISION: string;
export function runVerification(options: VerificationOptions): Promise<LocalVerificationEvidence>;
export function parseOracleConfiguration(value: unknown): OracleConfiguration;
export function parseVerificationSpec(value: unknown): VerificationSpec;
export function runOracleInput(options: {
  oracle: OracleConfiguration;
  cwd: string;
  input: string | Uint8Array;
  allowCommand: boolean;
  revision?: 'affected' | 'fixed';
  expectedOutcome?: 'pass' | 'fail';
}): Promise<OracleCell>;
export function evidenceHash(value: Omit<LocalVerificationEvidence, 'evidenceHash'> | LocalVerificationEvidence): string;
export function sha256(value: string | Uint8Array): string;
