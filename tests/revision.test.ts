import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createInvestigationStore } from '../apps/server/src/investigation-store.ts';
import { buildServer } from '../apps/server/src/server.ts';
import { compareRevisions } from '../packages/contracts/src/revision.ts';

test('historical revisions retain recorded text and only documents available at that revision', () => {
  const pilot = JSON.parse(readFileSync(new URL('../public/pilot/parcels.json', import.meta.url), 'utf8'));
  const store = createInvestigationStore();
  try {
    const original = store.create({ name: 'History case', question: '', notes: 'Original <script>text</script>' }, { dataset: 'pilot', releaseSha256: 'source', parcel: pilot.parcels[0], manifest: pilot.manifest });
    const updated = store.update(original.id, 0, { name: original.name, question: '', notes: 'Revised notes' });
    const attached = store.addDocument(original.id, 1, 'evidence.txt', 'text/plain', Buffer.from('Historical evidence'));
    assert.throws(() => store.addDocument(original.id, 2, 'second.txt', 'text/plain', Buffer.from('Historical evidence')), /Duplicate document/);
    assert.deepEqual(store.revision(original.id, 0), original);
    assert.deepEqual(store.revision(original.id, 1), updated);
    assert.deepEqual(store.revision(original.id, 2), attached);
    assert.equal(store.revision(original.id, 3), undefined);
    assert.equal(store.revision(randomUUID(), 0), undefined);
    assert.deepEqual(compareRevisions(original, updated), [{ path: 'notes', before: original.notes, after: updated.notes }]);
    assert.equal(compareRevisions(updated, attached)[0].path, `documents[${attached.documents[0].id}]`);
    assert.equal(compareRevisions(attached, attached).length, 0);
    assert.equal(compareRevisions(null, original).length, 5);
    const reordered = structuredClone(attached);
    reordered.documents.push({ ...reordered.documents[0], id: randomUUID() });
    assert.deepEqual(compareRevisions(reordered, { ...reordered, documents: [...reordered.documents].reverse() }), []);
    assert.equal(store.get(original.id)!.revision, 2);
    assert.equal(store.history(original.id).length, 3);
    const duplicate = store.addDocument(original.id, 2, 'second.txt', 'text/plain', Buffer.from('Historical evidence'), true);
    assert.equal(duplicate.documents.length, 2);
    assert.equal(duplicate.documents[0].sha256, duplicate.documents[1].sha256);
    assert.notEqual(duplicate.documents[0].id, duplicate.documents[1].id);
  } finally { store.close(); }
});

test('revision API returns immutable case-scoped records with no cache and validates revision numbers', async () => {
  const app = buildServer({ port: 4317 });
  const headers = { host: '127.0.0.1:4317' };
  const pilot = JSON.parse(readFileSync(new URL('../public/pilot/parcels.json', import.meta.url), 'utf8'));
  try {
    const { token } = (await app.inject({ url: '/api/session', headers })).json();
    const authenticated = { ...headers, 'x-local-token': token };
    const original = (await app.inject({ method: 'POST', url: '/api/investigations', headers: authenticated, payload: { name: 'History', question: '', notes: 'Before', parcelId: pilot.parcels[0].id, published: pilot.manifest.published, operationId: randomUUID() } })).json().investigation;
    await app.inject({ method: 'PUT', url: `/api/investigations/${original.id}`, headers: authenticated, payload: { name: 'History', question: '', notes: 'After', revision: 0 } });
    const response = await app.inject({ url: `/api/investigations/${original.id}/revisions/0`, headers });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.deepEqual(response.json().investigation, original);
    for (const revision of ['-1', '1.5', 'word']) assert.equal((await app.inject({ url: `/api/investigations/${original.id}/revisions/${revision}`, headers })).statusCode, 400);
    assert.equal((await app.inject({ url: `/api/investigations/${original.id}/revisions/2`, headers })).statusCode, 404);
    assert.equal((await app.inject({ url: `/api/investigations/${randomUUID()}/revisions/0`, headers })).statusCode, 404);
  } finally { await app.close(); }
});