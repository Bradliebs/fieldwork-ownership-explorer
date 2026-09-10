import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { buildServer } from '../apps/server/src/server.ts';

const pilotUrl = new URL('../public/pilot/parcels.json', import.meta.url);
const raw = readFileSync(pilotUrl);
const pilot = JSON.parse(raw.toString());
const headers = { host: '127.0.0.1:4317' };
const body = { name: '<script>bad()</script>', question: 'Title evidence?', notes: '<img src=x onerror=bad()>',
  parcelId: pilot.parcels[0].id, published: pilot.manifest.published, operationId: randomUUID() };

test('pilot APIs serve one coherent pinned release', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pilot-api-'));
  const app = buildServer({ port: 4317, investigationDb: join(directory, 'cases.sqlite') });
  try {
    const parcels = (await app.inject({ url: '/api/pilot-parcels', headers })).json();
    const basemap = (await app.inject({ url: '/api/pilot-basemap', headers })).json();
    const manifest = (await app.inject({ url: '/api/pilot-manifest', headers })).json();
    const release = (await app.inject({ url: '/api/pilot-release', headers })).json();
    assert.equal(parcels.parcels.length, release.counts.parcels);
    assert.equal(basemap.features.length, release.counts.basemapFeatures);
    assert.deepEqual(parcels.manifest, manifest);
    assert.equal(release.files.find((file: { path: string }) => file.path === 'parcels.json').sha256, createHash('sha256').update(raw).digest('hex'));
  } finally { await app.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('investigation API validates sources, protects writes, persists and escapes report content', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'investigation-api-'));
  const options = { port: 4317, investigationDb: join(directory, 'cases.sqlite') };
  let app = buildServer(options);
  try {
    assert.equal((await app.inject({ method: 'POST', url: '/api/investigations', headers, payload: body })).statusCode, 403);
    const session = (await app.inject({ url: '/api/session', headers })).json();
    const authenticated = { ...headers, 'x-local-token': session.token };
    for (const invalid of [{ ...body, parcelId: 'DEMO-001' }, { ...body, name: '   ' }, { ...body, snapshot: {} }, { ...body, notes: 'x'.repeat(8001) }]) {
      assert.equal((await app.inject({ method: 'POST', url: '/api/investigations', headers: authenticated, payload: invalid })).statusCode, 400);
    }
    assert.equal((await app.inject({ method: 'POST', url: '/api/investigations', headers: authenticated, payload: { ...body, published: '2000-01-01' } })).statusCode, 409);
    assert.equal((await app.inject({ method: 'POST', url: '/api/investigations', headers: authenticated, payload: { ...body, parcelId: 'INSPIRE-0' } })).statusCode, 404);
    const created = await app.inject({ method: 'POST', url: '/api/investigations', headers: authenticated, payload: body });
    assert.equal(created.statusCode, 201);
    const item = created.json().investigation;
    const replay = await app.inject({ method: 'POST', url: '/api/investigations', headers: authenticated, payload: body });
    assert.equal(replay.json().investigation.id, item.id);
    assert.equal(replay.json().history.length, 1);
    assert.equal((await app.inject({ method: 'POST', url: '/api/investigations', headers: authenticated, payload: { ...body, name: 'Changed retry' } })).statusCode, 409);
    assert.deepEqual(item.snapshot.parcel, pilot.parcels[0]);
    const payload = { name: body.name, question: body.question, notes: body.notes, revision: 0 };
    const results = await Promise.all([1, 2].map(() => app.inject({ method: 'PUT', url: `/api/investigations/${item.id}`, headers: authenticated, payload })));
    assert.deepEqual(results.map(result => result.statusCode).sort(), [200, 409]);
    await app.close();
    app = buildServer(options);
    const saved = (await app.inject({ url: `/api/investigations/${item.id}`, headers })).json();
    assert.equal(saved.investigation.revision, 1);
    assert.equal(saved.history.length, 2);
    const report = await app.inject({ url: `/api/investigations/${item.id}/report`, headers });
    assert.equal(report.statusCode, 200);
    assert.match(report.headers['content-security-policy'] as string, /frame-ancestors 'none'/);
    assert.equal(report.headers['cache-control'], 'no-store');
    assert.match(report.body, /&lt;script&gt;bad/);
    assert.doesNotMatch(report.body, /<img src=x|<script>bad/);
    assert.match(report.body, /Unknown. No ownership evidence loaded/);
    assert.match(report.body, /<svg/);
    assert.match(report.body, /Saved revision 1/);
    assert.deepEqual(readFileSync(pilotUrl), raw);
    assert.equal((await app.inject({ url: `/api/investigations/${item.id}/report`, headers: { host: 'evil.example' } })).statusCode, 403);
  } finally { await app.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('real sales are isolated from ownership and preserved across source changes and restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'sales-api-'));
  const release = JSON.parse(readFileSync(new URL('../public/pilot/sales.json', import.meta.url), 'utf8'));
  writeFileSync(join(directory, 'parcels.json'), raw);
  writeFileSync(join(directory, 'sales.json'), JSON.stringify(release));
  const options = { port: 4317, investigationDb: join(directory, 'cases.sqlite'), pilotPath: join(directory, 'parcels.json') };
  let app = buildServer(options);
  try {
    const session = (await app.inject({ url: '/api/session', headers })).json();
    const sale = release.records[0];
    assert.equal((await app.inject({ url: '/api/pilot-sales', headers })).json().sales.records.length, 4);
    const response = await app.inject({ method: 'POST', url: '/api/investigations', headers: { ...headers, 'x-local-token': session.token },
      payload: { ...body, parcelId: `INSPIRE-${sale.inspireIds[0]}`, operationId: randomUUID() } });
    assert.equal(response.statusCode, 201);
    const saved = response.json().investigation;
    assert.deepEqual(saved.snapshot.sales.records, [sale]);
    assert.deepEqual(saved.snapshot.parcel.links, []);
    writeFileSync(join(directory, 'sales.json'), JSON.stringify({ ...release, pilotSha256: 'wrong' }));
    assert.equal((await app.inject({ url: '/api/pilot-sales', headers })).statusCode, 409);
    await app.close(); app = buildServer(options);
    const reopened = (await app.inject({ url: `/api/investigations/${saved.id}`, headers })).json().investigation;
    assert.deepEqual(reopened.snapshot.sales, saved.snapshot.sales);
    const report = await app.inject({ url: `/api/investigations/${saved.id}/report`, headers });
    assert.equal(report.statusCode, 200);
    assert.ok(report.body.includes(sale.transactionId));
    assert.match(report.body, /Unknown. No ownership evidence loaded/);
    assert.match(report.body, /publication period 2026-07/);
    assert.ok(report.body.includes(release.sources[0].sha256));
  } finally { await app.close(); rmSync(directory, { recursive: true, force: true }); }
});