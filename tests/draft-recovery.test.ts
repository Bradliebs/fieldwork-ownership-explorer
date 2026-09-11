import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInvestigationStore } from '../apps/server/src/investigation-store.ts';
import { emptyWorkflow } from '../packages/contracts/src/consent.ts';
import type { InvestigationSnapshot } from '../packages/contracts/src/investigation.ts';
import { buildServer } from '../apps/server/src/server.ts';

const raw = readFileSync(new URL('../public/pilot/parcels.json', import.meta.url));
const pilot = JSON.parse(raw.toString());
const snapshot: InvestigationSnapshot = { dataset: 'pilot', parcel: pilot.parcels[0], manifest: pilot.manifest, releaseSha256: createHash('sha256').update(raw).digest('hex') };

test('version 2 upgrades preserve the case and create a version 2 safety backup', () => {
  const directory = mkdtempSync(join(tmpdir(), 'draft-upgrade-'));
  const path = join(directory, 'cases.sqlite');
  let store = createInvestigationStore(path);
  const saved = store.create({ name: 'Before draft upgrade', question: '', notes: 'Version 2 notes' }, snapshot);
  store.close();
  try {
    const legacy = new DatabaseSync(path);
    try { legacy.exec('DROP TABLE recovery_drafts; DELETE FROM schema_migrations WHERE version = 3; PRAGMA user_version = 2;'); }
    finally { legacy.close(); }
    store = createInvestigationStore(path);
    try { assert.deepEqual(store.get(saved.id), saved); assert.deepEqual(store.drafts(), []); }
    finally { store.close(); }
    const backups = readdirSync(directory).filter(name => name.startsWith('cases.sqlite.pre-v2-to-v3.'));
    assert.equal(backups.length, 1);
    const backup = new DatabaseSync(join(directory, backups[0]), { readOnly: true });
    try {
      assert.equal(backup.prepare('PRAGMA user_version').get()!.user_version, 2);
      assert.equal(backup.prepare('SELECT notes FROM investigations WHERE id = ?').get(saved.id)!.notes, saved.notes);
    } finally { backup.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('draft checkpoints survive restart separately from case revisions and reject stale or closed writes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'recovery-drafts-'));
  const path = join(directory, 'cases.sqlite');
  let store = createInvestigationStore(path);
  try {
    const edit = { name: 'Saved case', question: '', notes: 'Saved notes', workflow: emptyWorkflow() };
    const saved = store.create(edit, snapshot);
    const draft = { id: randomUUID(), sequence: 1, operationId: randomUUID(), investigationId: saved.id, baseRevision: 0, snapshot,
      edit: { ...edit, name: '', notes: 'Unfinished work' } };
    store.checkpoint(draft);
    assert.deepEqual(store.get(saved.id), saved);
    assert.equal(store.history(saved.id).length, 1);
    store.close();
    store = createInvestigationStore(path);
    assert.equal(store.drafts()[0].edit.notes, 'Unfinished work');
    assert.throws(() => store.checkpoint(draft), /sequence conflict/);
    store.checkpoint({ ...draft, sequence: 2 });
    assert.throws(() => store.checkpoint({ ...draft, sequence: 3, baseRevision: 1 }), /identity conflict/);
    store.closeDraft(draft.id);
    assert.deepEqual(store.drafts(), []);
    assert.throws(() => store.checkpoint({ ...draft, sequence: 3 }), /Draft closed/);
    const pending = { ...draft, id: randomUUID(), investigationId: null, baseRevision: null };
    store.closeDraft(pending.id);
    assert.throws(() => store.checkpoint(pending), /Draft closed/);
    assert.deepEqual(store.get(saved.id), saved);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('draft API protects writes, accepts incomplete forms, preserves snapshots and leaves reports unchanged', async () => {
  const app = buildServer({ port: 4317 });
  const headers = { host: '127.0.0.1:4317' };
  try {
    const session = (await app.inject({ url: '/api/session', headers })).json();
    const authenticated = { ...headers, 'x-local-token': session.token };
    const draftId = randomUUID();
    const payload = { sequence: 1, operationId: randomUUID(), investigationId: null, baseRevision: null,
      parcelId: snapshot.parcel.id, published: snapshot.manifest.published,
      edit: { name: '', question: '', notes: 'Recover me', workflow: emptyWorkflow() } };
    assert.equal((await app.inject({ method: 'PUT', url: `/api/recovery-drafts/${draftId}`, headers, payload })).statusCode, 403);
    assert.equal((await app.inject({ method: 'DELETE', url: `/api/recovery-drafts/${draftId}`, headers })).statusCode, 403);
    const checkpoint = await app.inject({ method: 'PUT', url: `/api/recovery-drafts/${draftId}`, headers: authenticated, payload });
    assert.equal(checkpoint.statusCode, 200, checkpoint.body);
    assert.deepEqual(checkpoint.json().draft.snapshot.parcel, snapshot.parcel);
    const listed = await app.inject({ url: '/api/recovery-drafts', headers });
    assert.equal(listed.headers['cache-control'], 'no-store');
    assert.equal(listed.json().drafts.length, 1);
    assert.deepEqual((await app.inject({ url: '/api/investigations', headers })).json().investigations, []);
    assert.equal((await app.inject({ method: 'PUT', url: `/api/recovery-drafts/${draftId}`, headers: authenticated, payload: { ...payload, sequence: 2, snapshot } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'PUT', url: `/api/recovery-drafts/${draftId}`, headers: authenticated, payload: { ...payload, sequence: 2, edit: { ...payload.edit, workflow: { ...emptyWorkflow(), parties: [{}] } } } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'DELETE', url: `/api/recovery-drafts/${draftId}`, headers: authenticated })).statusCode, 200);
    assert.equal((await app.inject({ method: 'PUT', url: `/api/recovery-drafts/${draftId}`, headers: authenticated, payload: { ...payload, sequence: 3 } })).statusCode, 409);
  } finally { await app.close(); }
});