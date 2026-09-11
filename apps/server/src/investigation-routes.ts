import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { createInvestigationStore } from './investigation-store.ts';
import { investigationReport } from './investigation-report.ts';
import type { InvestigationEdit } from '../../../packages/contracts/src/investigation.ts';
import type { Parcel, PilotManifest } from '../../../packages/contracts/src/ownership.ts';
import { salesForParcel } from '../../../packages/contracts/src/sales.ts';
import { readPilotSales } from './pilot-sales.ts';
import { ZodError } from 'zod';
import { consentRequest } from './consent-report.ts';

export function investigationRoutes(app: FastifyInstance, options: { investigationDb?: string; pilotPath?: string }) {
  const store = createInvestigationStore(options.investigationDb);
  app.addHook('onClose', async () => store.close());
  const pilotPath = options.pilotPath ?? resolve('public/pilot/parcels.json');
  const pilotRoot = dirname(pilotPath);
  app.get('/api/pilot-parcels', (_request, reply) => {
    try { return JSON.parse(readFileSync(pilotPath, 'utf8')); }
    catch { return reply.code(409).send({ error: 'Active parcel release is unavailable or invalid.' }); }
  });
  app.get('/api/pilot-basemap', (_request, reply) => {
    try { return JSON.parse(readFileSync(join(pilotRoot, 'basemap.json'), 'utf8')); }
    catch { return reply.code(409).send({ error: 'Active basemap release is unavailable or invalid.' }); }
  });
  app.get('/api/pilot-manifest', (_request, reply) => {
    try { return JSON.parse(readFileSync(join(pilotRoot, 'manifest.json'), 'utf8')); }
    catch { return reply.code(409).send({ error: 'Active source manifest is unavailable or invalid.' }); }
  });
  app.get('/api/pilot-release', (_request, reply) => {
    try { return JSON.parse(readFileSync(join(pilotRoot, 'release.json'), 'utf8')); }
    catch { return reply.code(409).send({ error: 'Active release descriptor is unavailable or invalid.' }); }
  });
  app.get('/api/pilot-sales', (_request, reply) => {
    try { return { sales: readPilotSales(pilotPath) ?? null }; }
    catch { return reply.code(409).send({ error: 'Sales extract is invalid or belongs to a different pilot release. Reimport before using sale evidence.' }); }
  });
  const fields = {
    name: { type: 'string', minLength: 1, maxLength: 160, pattern: '\\S' },
    question: { type: 'string', maxLength: 2000 },
    notes: { type: 'string', maxLength: 8000 },
    workflow: { type: 'object' },
  };
  const params = { type: 'object', required: ['id'], additionalProperties: false,
    properties: { id: { type: 'string', pattern: '^[0-9a-f-]{36}$' } } };
  app.get('/api/investigations', () => ({ investigations: store.list() }));
  app.post<{ Body: InvestigationEdit & { parcelId: string; published: string; operationId: string } }>('/api/investigations', { bodyLimit: 512_000, schema: { body: {
    type: 'object', additionalProperties: false, required: ['name', 'question', 'notes', 'parcelId', 'published', 'operationId'],
    properties: { ...fields, operationId: { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' }, parcelId: { type: 'string', pattern: '^INSPIRE-[0-9]+$', maxLength: 80 },
      published: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } },
  } } }, (request, reply) => {
    try {
      const raw = readFileSync(pilotPath);
      const data = JSON.parse(raw.toString('utf8')) as { parcels: Parcel[]; manifest: PilotManifest };
      if (data.manifest.published !== request.body.published) return reply.code(409).send({ error: 'Source release changed. Reload the parcel before creating an investigation.' });
      const parcel = data.parcels.find(item => item.id === request.body.parcelId);
      if (!parcel?.source) return reply.code(404).send({ error: 'Pilot parcel not found' });
      if (parcel.links.length) return reply.code(409).send({ error: 'Enriched source imports are not supported in this investigation version.' });
      const { name, question, notes, workflow } = request.body;
      const investigation = store.create({ name: name.trim(), question, notes, workflow }, {
        dataset: 'pilot', releaseSha256: createHash('sha256').update(raw).digest('hex'), parcel, manifest: data.manifest,
        sales: salesForParcel(readPilotSales(pilotPath), parcel.source.inspireId),
      }, request.body.operationId);
      return reply.code(201).send({ investigation, history: store.history(investigation.id) });
    } catch (error) {
      if (error instanceof ZodError) return reply.code(400).send({ error: error.issues.map(issue => issue.message).join('; ') });
      if (error instanceof Error && error.message === 'Evidence references a missing case document') return reply.code(400).send({ error: error.message });
      if (error instanceof Error && error.message === 'Creation conflict') return reply.code(409).send({ error: 'This investigation was already created with different content. Open it from Saved investigations before editing.' });
      return reply.code(500).send({ error: 'Investigation could not be created. Check local source data and storage.' });
    }
  });
  app.get<{ Params: { id: string } }>('/api/investigations/:id', { schema: { params } }, (request, reply) => {
    const investigation = store.get(request.params.id);
    if (!investigation) return reply.code(404).send({ error: 'Investigation not found' });
    return { investigation, history: store.history(investigation.id) };
  });
  app.put<{ Params: { id: string }; Body: InvestigationEdit & { revision: number } }>('/api/investigations/:id', { bodyLimit: 512_000, schema: { params, body: {
    type: 'object', additionalProperties: false, required: ['name', 'question', 'notes', 'revision'],
    properties: { ...fields, revision: { type: 'integer', minimum: 0 } },
  } } }, (request, reply) => {
    try {
      const { name, question, notes, revision, workflow } = request.body;
      const investigation = store.update(request.params.id, revision, { name: name.trim(), question, notes, workflow });
      return { investigation, history: store.history(investigation.id) };
    } catch (error) {
      if (error instanceof ZodError) return reply.code(400).send({ error: error.issues.map(issue => issue.message).join('; ') });
      if (error instanceof Error && error.message === 'Evidence references a missing case document') return reply.code(400).send({ error: error.message });
      if (error instanceof Error && error.message === 'Revision conflict') return reply.code(409).send({ error: 'The saved revision changed. Another window or a previous save whose response was lost may have updated it. This attempt made no changes. Your current draft remains in this window. Preserve any edits before reopening the saved version.' });
      if (error instanceof Error && error.message === 'Investigation not found') return reply.code(404).send({ error: error.message });
      return reply.code(500).send({ error: 'Investigation could not be saved. No changes were committed.' });
    }
  });
  app.get<{ Params: { id: string } }>('/api/investigations/:id/report', { schema: { params } }, (request, reply) => {
    const investigation = store.get(request.params.id);
    if (!investigation) return reply.code(404).send({ error: 'Investigation not found' });
    const nonce = randomBytes(24).toString('base64');
    reply.header('Content-Security-Policy', `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`);
    return reply.type('text/html; charset=utf-8').send(investigationReport(investigation, nonce));
  });
  app.post<{ Params: { id: string }; Body: { revision: number; name: string; mediaType: string; base64: string } }>('/api/investigations/:id/documents', { bodyLimit: 4_100_000, schema: { params, body: {
    type: 'object', additionalProperties: false, required: ['revision', 'name', 'mediaType', 'base64'], properties: {
      revision: { type: 'integer', minimum: 0 }, name: { type: 'string', minLength: 1, maxLength: 160 },
      mediaType: { enum: ['application/pdf', 'image/png', 'image/jpeg', 'text/plain'] },
      base64: { type: 'string', minLength: 4, maxLength: 4_000_000, pattern: '^[A-Za-z0-9+/]+={0,2}$' },
    },
  } } }, (request, reply) => {
    try {
      const { revision, name, mediaType, base64 } = request.body;
      const content = Buffer.from(base64, 'base64');
      if (content.toString('base64') !== base64) return reply.code(400).send({ error: 'Invalid document encoding' });
      const investigation = store.addDocument(request.params.id, revision, name, mediaType, content);
      return { investigation, history: store.history(investigation.id) };
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message === 'Revision conflict') return reply.code(409).send({ error: 'Case changed. Reopen the saved version before attaching evidence.' });
      if (message === 'Investigation not found') return reply.code(404).send({ error: message });
      if (/^(Invalid document|Only PDF|At most)/.test(message)) return reply.code(400).send({ error: message });
      return reply.code(500).send({ error: 'Document could not be saved. No changes were committed.' });
    }
  });
  const childParams = { type: 'object', required: ['id', 'childId'], additionalProperties: false, properties: { ...params.properties, childId: { type: 'string', pattern: '^[0-9a-f-]{36}$' } } };
  app.get<{ Params: { id: string; childId: string } }>('/api/investigations/:id/documents/:childId', { schema: { params: childParams } }, (request, reply) => {
    const document = store.document(request.params.id, request.params.childId);
    if (!document) return reply.code(404).send({ error: 'Document not found in this case' });
    reply.header('Content-Disposition', `attachment; filename="evidence"; filename*=UTF-8''${encodeURIComponent(document.metadata.name)}`);
    reply.header('Content-Security-Policy', "default-src 'none'; sandbox");
    return reply.type(document.metadata.mediaType).send(document.content);
  });
  app.get<{ Params: { id: string; childId: string } }>('/api/investigations/:id/requests/:childId', { schema: { params: childParams } }, (request, reply) => {
    const item = store.get(request.params.id);
    if (!item) return reply.code(404).send({ error: 'Investigation not found' });
    const nonce = randomBytes(24).toString('base64');
    try {
      const html = consentRequest(item, request.params.childId, nonce);
      reply.header('Content-Security-Policy', `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`);
      return reply.type('text/html; charset=utf-8').send(html);
    } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : 'Request unavailable' }); }
  });
}