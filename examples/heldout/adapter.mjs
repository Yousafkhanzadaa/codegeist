import { readFile } from 'node:fs/promises';
import { request } from 'node:http';
import { once } from 'node:events';
import { createImportServer } from './app.mjs';

export const ASSERTION_ID = 'invoice-import.preserves-customer-reference.v1';
export const FAILURE_KIND = 'valid-import-reference-resolution';
export const FAILURE_SITE = 'invoice-import.resolve-customer.v1';

export async function exerciseHttpImport(payload, { fixed = false } = {}) {
  const server = createImportServer({ fixed });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const result = await new Promise((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port: server.address().port, method: 'POST', path: '/imports/invoices',
        headers: { 'content-type': 'application/json', connection: 'close' } }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => {
          try { resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
          catch { reject(new Error('invalid-http-response')); }
        });
      });
      req.on('error', reject);
      req.end(JSON.stringify(payload));
    });
    return result;
  } finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

export async function checkImport(payload, options) {
  const { status, body } = await exerciseHttpImport(payload, options);
  const base = { version: 1, assertionId: ASSERTION_ID };
  if (status === 500 && body.code === 'CUSTOMER_LOOKUP_MISS') return { ...base, outcome: 'fail', failureKind: FAILURE_KIND, failureSite: FAILURE_SITE };
  if (status !== 201) return { ...base, outcome: 'fail', failureKind: 'application-input-rejected' };
  const expectedCustomers = new Map(payload.customers.map(customer => [customer.externalId, customer]));
  const preserved = body.imported === payload.invoices.length && body.invoices.length === payload.invoices.length
    && payload.invoices.every((invoice, index) => {
      const actual = body.invoices[index]; const owner = expectedCustomers.get(invoice.customerExternalId);
      return owner && actual.invoiceId === invoice.invoiceId && actual.customerExternalId === owner.externalId
        && actual.customerEmail === owner.email && actual.amountCents === invoice.amountCents
        && actual.currency === invoice.currency && actual.dueDate === invoice.dueDate;
    });
  return preserved ? { ...base, outcome: 'pass' } : { ...base, outcome: 'fail', failureKind: 'response-contract-mismatch' };
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  try {
    const [revision, input] = process.argv.slice(2);
    if (!['affected', 'fixed'].includes(revision) || !input) throw Error('invalid-adapter-arguments');
    const payload = JSON.parse(await readFile(input, 'utf8'));
    process.stdout.write(JSON.stringify(await checkImport(payload, { fixed: revision === 'fixed' })) + '\n');
  } catch { process.stderr.write('Local authored evaluation adapter unavailable.\n'); process.exitCode = 1; }
}
