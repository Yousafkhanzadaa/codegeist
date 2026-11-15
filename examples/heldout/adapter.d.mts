export const ASSERTION_ID: string;
export const FAILURE_KIND: string;
export const FAILURE_SITE: string;
export function exerciseHttpImport(payload: unknown, options?: { fixed?: boolean }): Promise<{ status: number; body: unknown }>;
export function checkImport(payload: unknown, options?: { fixed?: boolean }): Promise<{ version: number; assertionId: string; outcome: 'pass' | 'fail'; failureKind?: string; failureSite?: string }>;
