import { describe, expect, it, vi } from 'vitest';
import { reserve, type LedgerStore } from '../../src/server/ledger';

function atomicStore() {
  const values = new Map<string, unknown>();
  const store: LedgerStore = {
    async get<T>(key: string) { return values.get(key) as T | undefined; },
    async set(key, value, options) {
      if (options?.keyPolicy === 'FAIL_IF_EXISTS' && values.has(key)) throw new Error('Conflict');
      values.set(key, value);
    },
    async delete(key) { values.delete(key); },
  };
  return { store, values };
}

describe('publication ownership reservations', () => {
  it('gives exactly one of many concurrent attempts ownership', async () => {
    const { store, values } = atomicStore();
    const attempts = await Promise.all(Array.from({ length: 32 }, (_, owner) => reserve(store, 'publication', { owner })));
    expect(attempts.filter(attempt => attempt.acquired)).toHaveLength(1);
    for (const attempt of attempts) {
      if (!attempt.acquired) expect(attempt.existing).toEqual(values.get('publication'));
    }
  });

  it('uses the conditional store write, rather than a read followed by a write', async () => {
    const { store } = atomicStore();
    const get = vi.spyOn(store, 'get');
    const set = vi.spyOn(store, 'set');
    await expect(reserve(store, 'publication', { phase: 'creating' })).resolves.toEqual({ acquired: true });
    expect(get).not.toHaveBeenCalled();
    expect(set).toHaveBeenCalledWith('publication', { phase: 'creating' }, { keyPolicy: 'FAIL_IF_EXISTS' });
  });

  it('fails closed when the write fails and no reservation exists', async () => {
    const { store } = atomicStore();
    vi.spyOn(store, 'set').mockRejectedValue(new Error('Storage unavailable'));
    await expect(reserve(store, 'publication', { phase: 'creating' })).rejects.toThrow('Nothing was created');
  });

  it('fails closed when both write and recovery read fail', async () => {
    const { store } = atomicStore();
    vi.spyOn(store, 'set').mockRejectedValue(new Error('Write unavailable'));
    vi.spyOn(store, 'get').mockRejectedValue(new Error('Read unavailable'));
    await expect(reserve(store, 'publication', { phase: 'creating' })).rejects.toThrow('Nothing was created');
  });

  it('does not claim ownership after a write commits but its response is lost', async () => {
    const { store, values } = atomicStore();
    vi.spyOn(store, 'set').mockImplementation(async (key, value) => {
      values.set(key, value);
      throw new Error('Response lost after commit');
    });
    await expect(reserve(store, 'publication', { phase: 'creating' })).resolves.toEqual({ acquired: false, existing: { phase: 'creating' } });
  });
});
