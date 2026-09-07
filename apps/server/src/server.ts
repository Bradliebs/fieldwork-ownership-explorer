import Fastify from 'fastify';
import { randomBytes } from 'node:crypto';
import { createStore, type Decision } from './store.ts';
import { parcelStatus } from '../../../packages/contracts/src/ownership.ts';
import { investigationRoutes } from './investigation-routes.ts';

export function buildServer(options: { port: number; journal?: string; investigationDb?: string; pilotPath?: string }) {
  const app = Fastify({ bodyLimit: 16384, ajv: { customOptions: { removeAdditional: false } } });
  const store = createStore(options.journal);
  const token = randomBytes(32).toString('hex');
  const host = `127.0.0.1:${options.port}`;
  app.addHook('onRequest', async (request, reply) => {
    if (request.headers.host !== host ||
      (request.headers.origin && request.headers.origin !== `http://${host}`) ||
      request.headers['sec-fetch-site'] === 'cross-site') {
      return reply.code(403).send({ error: 'Local same-origin access only' });
    }
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    if (request.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(request.method) && request.headers['x-local-token'] !== token) {
      return reply.code(403).send({ error: 'Local session token required' });
    }
  });
  investigationRoutes(app, options);
  app.get('/api/session', () => ({ token, mode: 'synthetic', persistence: options.journal ? 'local-journal' : 'memory' }));
  app.get('/api/parcels', () => ({ parcels: store.parcels }));
  app.get('/api/decisions', () => ({ decisions: store.decisions }));
  app.get('/api/status', () => ({ mode: 'synthetic', liveDataLoaded: false, count: store.parcels.length,
    gates: ['Live-data licences not confirmed', 'PostGIS not connected', 'GDAL / GeoPackage export not configured', 'ArcGIS Pro compatibility not tested'],
  }));
  app.post<{ Body: Omit<Decision, 'at'> }>('/api/reviews', { schema: { body: {
    type: 'object', additionalProperties: false,
    required: ['parcelId', 'linkId', 'revision', 'review', 'reviewer', 'reason'],
    properties: {
      parcelId: { type: 'string', maxLength: 80 }, linkId: { type: 'string', maxLength: 80 },
      revision: { type: 'integer', minimum: 0 }, review: { enum: ['pending', 'reviewed', 'rejected'] },
      reviewer: { type: 'string', minLength: 1, maxLength: 100, pattern: '\\S' },
      reason: { type: 'string', minLength: 1, maxLength: 2000, pattern: '\\S' },
    },
  } } }, (request, reply) => {
    const decision = { ...request.body, at: new Date().toISOString() };
    try {
      store.save(decision);
      return { parcel: store.parcels.find(parcel => parcel.id === decision.parcelId) };
    } catch (error) {
      if (error instanceof Error && error.message === 'Revision conflict') return reply.code(409).send({ error: 'Record changed. Reload before reviewing.' });
      if (error instanceof Error && error.message === 'Unknown parcel or link') return reply.code(404).send({ error: error.message });
      return reply.code(500).send({ error: 'Review could not be saved. No in-memory changes applied.' });
    }
  });
  app.get<{ Querystring: { ids?: string } }>('/api/export', { schema: { querystring: {
    type: 'object', additionalProperties: false, required: ['ids'], properties: { ids: { type: 'string', minLength: 1, maxLength: 2000 } },
  } } }, (request, reply) => {
    const ids = request.query.ids!.split(',');
    if (ids.some(id => !store.parcels.some(parcel => parcel.id === id))) return reply.code(400).send({ error: 'Unknown parcel selection' });
    reply.header('Content-Disposition', 'attachment; filename="synthetic-ownership.geojson"');
    return { type: 'FeatureCollection', synthetic: true, notice: 'Fictional geometry and ownership; not land registry data. WGS84 coordinates.',
      features: store.parcels.filter(parcel => ids.includes(parcel.id)).map(parcel => ({
        type: 'Feature', id: parcel.id, geometry: parcel.geometry,
        properties: { id: parcel.id, label: parcel.label, synthetic: true, status: parcelStatus(parcel), links: parcel.links, revision: parcel.revision },
      })),
    };
  });
  return app;
}