import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import { buildServer } from './server.ts';

const port = Number(process.env.PORT ?? 4317);
const app = buildServer({ port, journal: resolve('.local/demo-reviews.jsonl'),
  investigationDb: resolve('.local/investigations.sqlite'), pilotPath: resolve('dist/pilot/parcels.json') });
await app.register(fastifyStatic, { root: resolve('dist') });
await app.listen({ host: '127.0.0.1', port });
console.log(`Ownership Explorer: http://127.0.0.1:${port} (Bristol pilot; local investigations)`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => { await app.close(); process.exit(0); });
}