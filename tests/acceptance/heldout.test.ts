import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { importInvoices, validateImport } from '../../examples/heldout/app.mjs';
import { checkImport, exerciseHttpImport } from '../../examples/heldout/adapter.mjs';
import { parseInputContract, validateContractPayload } from '../../local/input-contract.mjs';
import { PORTABLE_RUNTIME_HASHES } from '../../local/portable-runtime-hashes.mjs';

const base = resolve('examples/heldout');
const load = async (path: string) => JSON.parse(await readFile(resolve(base, path), 'utf8'));

describe('frozen authored full-application evaluation boundary', () => {
  it('keeps the Forge-approved portable runtime pins aligned with shipped local code', async () => {
    expect(Object.keys(PORTABLE_RUNTIME_HASHES).sort()).toEqual(['input-contract.mjs', 'json.mjs', 'protocol.mjs']);
    for (const [name, expectedHash] of Object.entries(PORTABLE_RUNTIME_HASHES)) {
      expect(createHash('sha256').update(await readFile(resolve('local', name))).digest('hex'), name).toBe(expectedHash);
    }
  });
  it('keeps all six tasks, application/test code, profiles and exact first engine snapshot unchanged', async () => {
    for (const name of ['freeze.json', 'engine-snapshot.json', 'first-results-manifest.json', 'upstream-generic-evaluation/freeze.json']) {
      const manifest = await load(name);
      const manifestRoot = name.startsWith('upstream-generic-evaluation/') ? resolve(base, 'upstream-generic-evaluation') : base;
      for (const file of manifest.files) expect(createHash('sha256').update(await readFile(resolve(manifestRoot, file.path))).digest('hex'), file.path).toBe(file.sha256);
    }
    const tasks = await load('tasks.json');
    expect(tasks.tasks).toHaveLength(6);
    expect(tasks.tasks.slice(0, 3).every((task: { profile: string }) => task.profile === 'profile.json')).toBe(true);
    const freeze = await load('freeze.json');
    expect(createHash('sha256').update(await readFile(resolve(base, 'engine-snapshot/workflow.mjs'))).digest('hex')).toBe(freeze.engineAtFreeze.sha256);
  });

  it.each(['T01', 'T02', 'T03'])('validates %s then exposes the real import lookup failure, with an exact-lookup fixed control', async task => {
    const source = await load(`fixtures/${task}.json`);
    const profile = await load('profile.json');
    expect(validateContractPayload(source, parseInputContract(profile.contract)).valid).toBe(true);
    expect(validateImport(source)).toEqual(source);
    expect(() => importInvoices(source)).toThrow('CUSTOMER_LOOKUP_MISS');
    const fixed = importInvoices(source, { fixed: true });
    expect(fixed.imported).toBe(2);
    expect(fixed.invoices.map(invoice => invoice.customerExternalId)).toEqual(source.customers.map((customer: { externalId: string }) => customer.externalId));
    expect(fixed.invoices.map(invoice => invoice.customerEmail)).toEqual(source.customers.map((customer: { email: string }) => customer.email));
  });

  it('has an ordinary valid short-ID control and refuses a foreign key not present in the batch', async () => {
    const safe = await load('fixtures/T04.json');
    expect(importInvoices(safe)).toEqual(importInvoices(safe, { fixed: true }));
    const invalid = await load('fixtures/T05.json');
    expect(() => validateImport(invalid)).toThrow('UNKNOWN_CUSTOMER');
    const profile = await load('profile.json');
    expect(validateContractPayload(invalid, parseInputContract(profile.contract)).valid).toBe(false);
  });

  it('makes the private-prerequisite negative truthful: original is valid, changed prerequisite is invalid', async () => {
    const source = await load('fixtures/T06.json');
    expect(validateImport(source)).toEqual(source);
    expect(() => importInvoices(source)).toThrow('CUSTOMER_LOOKUP_MISS');
    expect(() => validateImport({ ...source, caseToken: 'a-different-fictional-value' })).toThrow('INVALID_CASE_TOKEN');
    const profile = await load('profile-private-prerequisite.json');
    expect(profile.contract.schema.required).toContain('caseToken');
  });

  it('validates uniqueness, formats and exact request structure before persistence', async () => {
    const source = await load('fixtures/T01.json');
    const duplicate = structuredClone(source); duplicate.invoices[1].invoiceId = duplicate.invoices[0].invoiceId;
    expect(() => validateImport(duplicate)).toThrow('DUPLICATE_INVOICE');
    const date = structuredClone(source); date.invoices[0].dueDate = '2026-02-30';
    expect(() => validateImport(date)).toThrow('INVALID_INVOICE');
    const amount = structuredClone(source); amount.invoices[0].amountCents = 0;
    expect(() => validateImport(amount)).toThrow('INVALID_INVOICE');
    expect(() => validateImport({ ...source, unknown: 'not-declared' })).toThrow('INVALID_STRUCTURE');
  });
});

describe.skipIf(process.env.REPROSHARE_HTTP_ACCEPTANCE !== '1')('actual loopback HTTP application assertion (explicit socket permission)', () => {
  it.each(['T01', 'T02', 'T03'])('exercises %s through the HTTP parser/validator/controller and fixed response contract', async task => {
    const source = await load(`fixtures/${task}.json`);
    expect(await exerciseHttpImport(source)).toMatchObject({ status: 500, body: { code: 'CUSTOMER_LOOKUP_MISS' } });
    expect(await checkImport(source, { fixed: false })).toMatchObject({ outcome: 'fail', failureKind: 'valid-import-reference-resolution', failureSite: 'invoice-import.resolve-customer.v1' });
    expect(await checkImport(source, { fixed: true })).toMatchObject({ outcome: 'pass' });
  });
  it('distinguishes a rejected application precondition from the selected bug', async () => {
    const source = await load('fixtures/T05.json');
    expect(await exerciseHttpImport(source)).toMatchObject({ status: 422, body: { code: 'UNKNOWN_CUSTOMER' } });
    expect(await checkImport(source, { fixed: false })).toMatchObject({ outcome: 'fail', failureKind: 'application-input-rejected' });
  });
});
