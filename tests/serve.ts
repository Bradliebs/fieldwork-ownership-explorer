import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import { buildServer } from '../apps/server/src/server.ts';

const temporary = mkdtempSync(join(tmpdir(), 'ownership-browser-'));
const app = buildServer({ port: 4318, journal: join(temporary, 'reviews.jsonl') });
await app.register(fastifyStatic, { root: resolve('dist') });
await app.listen({ host: '127.0.0.1', port: 4318 });
process.on('exit', () => rmSync(temporary, { recursive: true, force: true }));