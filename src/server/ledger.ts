import type { AiBrief } from '../shared/contracts';

export interface LedgerStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown, options?: { keyPolicy?: 'FAIL_IF_EXISTS'; ttl?: { value: number; unit: 'HOURS' | 'DAYS' } }): Promise<unknown>;
  delete(key: string): Promise<unknown>;
}

export async function reserve<T>(store: LedgerStore, key: string, value: T): Promise<{ acquired: true } | { acquired: false; existing: T }> {
  try {
    await store.set(key, value, { keyPolicy: 'FAIL_IF_EXISTS' });
    return { acquired: true };
  } catch {
    // A storage outage must never be mistaken for successful ownership.
    let existing: T | undefined;
    try { existing = await store.get<T>(key); } catch { /* fail closed below */ }
    if (!existing) throw new Error('The sharing reservation could not be saved. Nothing was created. Please try again later.');
    return { acquired: false, existing };
  }
}

export interface Artifact {
  name: string;
  content: string;
  mimeType: string;
  hash: string;
}

export interface Publication {
  phase: 'creating' | 'unknown' | 'created' | 'partial' | 'complete' | 'rejected';
  marker: string;
  createdAt: number;
  issueId?: string;
  issueKey?: string;
  issueUrl?: string;
  error?: string;
  aiBrief?: AiBrief;
}

export interface ArtifactState {
  phase: 'uploading' | 'unknown' | 'complete';
  attachmentId?: string;
}
