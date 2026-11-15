import type { Server } from 'node:http';
export const APPLICATION_REVISION: string;
export const FIXED_REVISION: string;
export interface ImportedInvoice {
  invoiceId: string;
  customerExternalId: string;
  customerEmail: string;
  amountCents: number;
  currency: string;
  dueDate: string;
}
export function validateImport(payload: unknown): unknown;
export function importInvoices(payload: unknown, options?: { fixed?: boolean }): { batchId: string; imported: number; invoices: ImportedInvoice[] };
export function createImportServer(options?: { fixed?: boolean }): Server;
