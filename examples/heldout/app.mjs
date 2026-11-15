import { createServer } from 'node:http';

// Authored evaluation application. This is an intentional regression in a
// realistic import boundary, not a claimed defect in an upstream product.
export const APPLICATION_REVISION = 'invoice-import-truncation-before-v1';
export const FIXED_REVISION = 'invoice-import-exact-lookup-v1';
const TOKEN = 'fictional-heldout-authorisation-v1';
const CURRENCIES = new Set(['USD', 'EUR', 'GBP']);

function invalid(code) { const error = new Error(code); error.code = code; throw error; }
function object(value, allowed, required = allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) invalid('INVALID_STRUCTURE');
}
function text(value, max = 64) { return typeof value === 'string' && value.length > 0 && value.length <= max; }
function date(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00.000Z')) && new Date(value + 'T00:00:00.000Z').toISOString().slice(0, 10) === value; }

/** Validate types, formats, uniqueness and all foreign keys before persistence. */
export function validateImport(payload) {
  object(payload, ['batchId', 'customers', 'invoices', 'note', 'caseToken'], ['batchId', 'customers', 'invoices']);
  if (!text(payload.batchId) || payload.note !== undefined && !text(payload.note, 1024)) invalid('INVALID_BATCH');
  // The negative case deliberately models an unchangeable private prerequisite.
  // This fictional token has no authority outside this local fixture application.
  if (payload.caseToken !== undefined && payload.caseToken !== TOKEN) invalid('INVALID_CASE_TOKEN');
  if (!Array.isArray(payload.customers) || !payload.customers.length || payload.customers.length > 20
    || !Array.isArray(payload.invoices) || !payload.invoices.length || payload.invoices.length > 40) invalid('INVALID_BATCH_SIZE');
  const customers = new Map();
  for (const customer of payload.customers) {
    object(customer, ['externalId', 'email', 'name'], ['externalId', 'email']);
    if (!text(customer.externalId) || typeof customer.email !== 'string' || customer.email.length > 254
      || !/^[a-z0-9][a-z0-9._+-]*@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(customer.email)
      || customer.name !== undefined && !text(customer.name, 100)) invalid('INVALID_CUSTOMER');
    if (customers.has(customer.externalId)) invalid('DUPLICATE_CUSTOMER');
    customers.set(customer.externalId, customer);
  }
  const invoices = new Set();
  for (const invoice of payload.invoices) {
    object(invoice, ['invoiceId', 'customerExternalId', 'amountCents', 'currency', 'dueDate', 'memo'], ['invoiceId', 'customerExternalId', 'amountCents', 'currency', 'dueDate']);
    if (!text(invoice.invoiceId) || !text(invoice.customerExternalId) || !Number.isSafeInteger(invoice.amountCents)
      || invoice.amountCents <= 0 || invoice.amountCents > 100_000_000 || !CURRENCIES.has(invoice.currency)
      || !date(invoice.dueDate) || invoice.memo !== undefined && !text(invoice.memo, 512)) invalid('INVALID_INVOICE');
    if (invoices.has(invoice.invoiceId)) invalid('DUPLICATE_INVOICE');
    if (!customers.has(invoice.customerExternalId)) invalid('UNKNOWN_CUSTOMER');
    invoices.add(invoice.invoiceId);
  }
  return payload;
}

export function importInvoices(payload, { fixed = false } = {}) {
  validateImport(payload);
  const database = { customers: new Map(payload.customers.map(customer => [customer.externalId, structuredClone(customer)])), invoices: [] };
  for (const invoice of payload.invoices) {
    // Intentional regression: the request validator accepts full 64-character
    // IDs, but this lookup still follows a legacy 32-character column limit.
    const lookup = fixed ? invoice.customerExternalId : invoice.customerExternalId.slice(0, 32);
    const customer = database.customers.get(lookup);
    if (!customer) invalid('CUSTOMER_LOOKUP_MISS');
    database.invoices.push({ invoiceId: invoice.invoiceId, customerExternalId: customer.externalId,
      customerEmail: customer.email, amountCents: invoice.amountCents, currency: invoice.currency, dueDate: invoice.dueDate });
  }
  return { batchId: payload.batchId, imported: database.invoices.length, invoices: database.invoices };
}

export function createImportServer({ fixed = false } = {}) {
  return createServer(async (request, response) => {
    const send = (status, value) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)); };
    if (request.method !== 'POST' || request.url !== '/imports/invoices') return send(404, { code: 'NOT_FOUND' });
    if (request.headers['content-type'] !== 'application/json') return send(415, { code: 'JSON_REQUIRED' });
    const chunks = []; let size = 0;
    try {
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 65_536) return send(413, { code: 'PAYLOAD_TOO_LARGE' });
        chunks.push(chunk);
      }
      let payload;
      try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(400, { code: 'INVALID_JSON' }); }
      try { validateImport(payload); } catch (error) { return send(422, { code: error.code ?? 'INVALID_INPUT' }); }
      try { return send(201, importInvoices(payload, { fixed })); }
      catch (error) { return send(500, { code: error.code === 'CUSTOMER_LOOKUP_MISS' ? 'CUSTOMER_LOOKUP_MISS' : 'IMPORT_FAILED' }); }
    } catch { if (!response.headersSent) send(400, { code: 'REQUEST_FAILED' }); }
  });
}
