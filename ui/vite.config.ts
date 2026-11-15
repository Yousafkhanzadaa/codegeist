import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { prepareRepro, samplePayloads, scanPayload } from '../src/domain/index';
import { attachLocalEvidence } from '../src/domain/verification';
import { prepareLocalWorkflow } from '../src/domain/local-workflow';
import type { ReviewDraft } from '../src/shared/contracts';

function localEngine(): Plugin {
  const reviews = new Map<string, ReviewDraft>();
  const savedAt = new Map<string, number>();
  const keep = (draft: ReviewDraft) => {
    if (reviews.size >= 100) { const oldest = reviews.keys().next().value!; reviews.delete(oldest); savedAt.delete(oldest); }
    reviews.set(draft.reviewId, draft); savedAt.set(draft.reviewId, Date.now());
  };
  return {
    name: 'reproshare-local-engine',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__reproshare', (request, response) => {
        const send = (status: number, value: unknown) => {
          response.statusCode = status;
          response.setHeader('Content-Type', 'application/json; charset=utf-8');
          response.setHeader('Cache-Control', 'no-store');
          response.setHeader('X-Content-Type-Options', 'nosniff');
          response.end(JSON.stringify(value));
        };
        const host = request.headers.host ?? '';
        if (!/^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(host)) {
          send(403, { error: 'The preview engine is available on loopback only.' }); return;
        }
        if (request.headers.origin && request.headers.origin !== `http://${host}`) {
          send(403, { error: 'Cross-origin preview requests are not allowed.' }); return;
        }
        const path = request.url?.split('?')[0];
        if (path === '/samples' && request.method === 'GET') {
          send(200, Object.entries(samplePayloads).map(([id, sample]) => ({ id, title: sample.title, description: sample.description, sourceJson: sample.json, applicationCaseId: sample.applicationCaseId, expectedBehavior: sample.expectedBehavior, observedBehavior: sample.observedBehavior })));
          return;
        }
        if (path === '/recent' && request.method === 'GET') {
          send(200, [...reviews.values()].reverse().slice(0, 20).map(draft => ({ reviewId: draft.reviewId, title: draft.repro.title, createdAt: savedAt.get(draft.reviewId) ?? Date.now(), fixtureHash: draft.repro.fixtureHash, evidenceLevel: draft.repro.publicVerification?.evidenceLevel ?? 'prepared', expired: false, stale: false }))); return;
        }
        if (!['/scan', '/prepare', '/import-local', '/import-workflow', '/resume'].includes(path ?? '')) { send(404, { error: 'Unknown local preview endpoint.' }); return; }
        if (request.method !== 'POST') { send(405, { error: 'Use POST for local engine requests.' }); return; }
        if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] ?? '')) { send(415, { error: 'Supply a JSON request body.' }); return; }
        void readBody(request, response).then(body => {
          if (response.writableEnded) return;
          const input: unknown = JSON.parse(body);
          if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Supply a JSON object.');
          const data = input as Record<string, unknown>;
          if (path === '/resume') {
            const prior = typeof data.reviewId === 'string' ? reviews.get(data.reviewId) : undefined;
            if (!prior) throw new Error('This preview review is unavailable. Prepare a new package.');
            const next = { ...prior, reviewId: `preview-${randomUUID()}` }; keep(next); send(200, next); return;
          }
          if (path === '/import-workflow') {
            if (typeof data.packageJson !== 'string') throw new Error('Choose a source-side application review package.');
            const next: ReviewDraft = { reviewId: `preview-${randomUUID()}`, repro: prepareLocalWorkflow(data.packageJson), sourceIssue: {
              id: 'preview-10001', key: 'SUP-142', summary: 'Private application report', projectName: 'Customer support · simulated context', updated: '2026-11-12T07:00:00.000Z', attachments: [],
            } };
            keep(next); send(200, next); return;
          }
          if (path === '/import-local') {
            const draft = typeof data.reviewId === 'string' ? reviews.get(data.reviewId) : undefined;
            if (!draft || typeof data.reportJson !== 'string') throw new Error('Prepare a new preview before importing a local report.');
            const next = { ...draft, reviewId: `preview-${randomUUID()}`, repro: attachLocalEvidence(draft.repro, data.reportJson) };
            keep(next); send(200, next); return;
          }
          if (typeof data.sourceJson !== 'string') throw new Error('Supply a JSON string to scan.');
          if (path === '/scan') { send(200, scanPayload(data.sourceJson)); return; }
          if (typeof data.candidateId !== 'string' || data.candidateId.length > 256 || data.seed !== undefined && (typeof data.seed !== 'string' || data.seed.length > 128)) throw new Error('Supply a selected condition and an optional private seed of at most 128 characters.');
          if (data.applicationCaseId !== undefined && data.applicationCaseId !== 'hermes-integer-coercion' && data.applicationCaseId !== 'es-toolkit-deburr') throw new Error('Choose a supported application regression case.');
          if (data.inputContract !== undefined && typeof data.inputContract !== 'string') throw new Error('Supply input requirements as JSON text.');
          const repro = prepareRepro({ sourceJson: data.sourceJson, candidateId: data.candidateId, seed: data.seed as string | undefined, ...(data.applicationCaseId ? { applicationCaseId: data.applicationCaseId } : {}), ...(data.inputContract ? { inputContract: data.inputContract as string } : {}) });
          const draft = { reviewId: `preview-${randomUUID()}`, repro, sourceIssue: {
            id: 'preview-10001', key: 'SUP-142', summary: 'Imported customer records merge unexpectedly',
            projectName: 'Customer support · simulated context', updated: '2026-11-12T07:00:00.000Z', attachments: [],
          } };
          keep(draft); send(200, draft);
        }).catch(error => { if (!response.writableEnded) send(400, { error: error instanceof Error ? error.message : 'The local check could not be completed.' }); });
      });
    },
  };
}

function readBody(request: IncomingMessage, response: ServerResponse): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 384 * 1024) {
        chunks.length = 0;
        if (!response.writableEnded) {
          response.statusCode = 413;
          response.setHeader('Content-Type', 'application/json; charset=utf-8');
          response.end(JSON.stringify({ error: 'The local request is too large. Source JSON must be at most 64 KiB.' }));
        }
        reject(new Error('Request exceeds 384 KiB.'));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
    request.on('aborted', () => reject(new Error('Request interrupted.')));
  });
}

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  plugins: [react(), localEngine()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: { host: '127.0.0.1', port: 5173 },
});
