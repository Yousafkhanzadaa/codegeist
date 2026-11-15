export class VerificationError extends Error { code: string; constructor(code: string); }
export const JSON_LIMITS: { bytes: number; depth: number; nodes: number; keys: number; array: number; string: number };
export function parseBoundedJson(bytes: string | Uint8Array, limits?: typeof JSON_LIMITS): unknown;
export function canonicalJson(value: unknown): string;
