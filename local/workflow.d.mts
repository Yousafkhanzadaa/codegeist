import type { InputContractV1 } from '../src/domain/input-contract';
import type { OracleConfiguration, VerificationSpec } from './protocol.mjs';
import type { JsonValue } from '../src/domain/json';
export interface ServiceProfile {
  version: 1;
  id: string;
  title: string;
  contract: InputContractV1;
  oracle: OracleConfiguration;
  budget: { maxRuns: number; maxDurationMs: number; repeats: number };
}
export interface SearchSummary {
  version: 1;
  kind: 'reproshare-search-summary';
  runs: number;
  candidates: number;
  invalidCandidates: number;
  differentOutcomes: number;
  minimizationChecks: number;
  removedParts: number;
  elapsedMs: number;
  originalBytes: number;
  fixtureBytes: number;
  scope: 'bounded-local-search-not-global-minimum';
  stoppedByBudget: boolean;
  decisions: string[];
  disclosures: string[];
}
export function parseServiceProfile(value: unknown): ServiceProfile;
export function verificationSpecForProfile(profile: ServiceProfile): VerificationSpec;
export function hasPrivateValue(candidate: JsonValue, original: JsonValue, contract: InputContractV1): boolean;
export function synthesizeWorkflow(options: {
  sourceJson: string;
  profile: unknown;
  cwd: string;
  allowCommand: boolean;
  onProgress?: (progress: Record<string, number | string>) => void;
  signal?: AbortSignal;
}): Promise<{
  fixtureJson: string;
  ordinaryJson: string;
  inputContract: InputContractV1;
  inputContractHash: string;
  verificationSpec: VerificationSpec;
  testSpecHash: string;
  configurationHash: string;
  searchSummary: SearchSummary;
}>;
