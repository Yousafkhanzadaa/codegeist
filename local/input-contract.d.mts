import type { InputContractV1 } from '../src/domain/input-contract';
import type { JsonValue } from '../src/domain/json';
export function parseInputContract(input: string | unknown): InputContractV1;
export function canonicalInputContract(contract: InputContractV1): string;
export function inputContractHash(contract: InputContractV1): string;
export function validateContractPayload(payload: JsonValue, contract: InputContractV1): { valid: boolean; violations: string[] };
export function parseContractPayload(source: string): JsonValue;
