import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServer } from '../apps/server/src/server.ts';
import { createStore } from '../apps/server/src/store.ts';

const headers = { host: '127.0.0.1:4317' };
test('API rejects cross-origin and forged Host access', async () => {
  const app = buildServer({ port: 4317 });
  try {
    assert.equal((await app.inject({ url: '/api/session', headers: { host: 'evil.example' } })).statusCode, 403);
    assert.equal((await app.inject({ url: '/api/session', headers: { ...headers, origin: 'https://evil.example' } })).statusCode, 403);
    assert.equal((await app.inject({ method: 'POST', url: '/api/reviews', headers, payload: {} })).statusCode, 403);
  } finally { await app.close(); }
});

test('review API preserves candidate status, rejects promotion and stale revisions, persists decisions', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ownership-'));
  const journal = join(directory, 'reviews.jsonl');
  const app = buildServer({ port: 4317, journal });
  try {
    const session = (await app.inject({ url: '/api/session', headers })).json();
    const authenticated = { ...headers, 'x-local-token': session.token };
    const body = { parcelId: 'DEMO-002', linkId: 'demo-link-2', revision: 0, review: 'reviewed', reviewer: 'Tester', reason: 'Address remains inferred' };
    assert.equal((await app.inject({ method: 'POST', url: '/api/reviews', headers: authenticated, payload: { ...body, status: 'verified' } })).statusCode, 400);
    const saved = await app.inject({ method: 'POST', url: '/api/reviews', headers: authenticated, payload: body });
    assert.equal(saved.statusCode, 200);
    assert.equal(saved.json().parcel.links[0].status, 'candidate');
    assert.equal((await app.inject({ method: 'POST', url: '/api/reviews', headers: authenticated, payload: body })).statusCode, 409);
    assert.equal(createStore(journal).parcels[1].links[0].review, 'reviewed');
    const exported = (await app.inject({ url: '/api/export?ids=DEMO-002', headers })).json();
    assert.equal(exported.synthetic, true);
    assert.equal(exported.features[0].properties.links[0].status, 'candidate');
  } finally { await app.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('malformed journal fails loudly instead of losing review history', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ownership-'));
  try {
    const journal = join(directory, 'broken.jsonl');
    writeFileSync(journal, '{broken');
    assert.throws(() => createStore(journal));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});