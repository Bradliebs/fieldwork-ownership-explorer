import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createInvestigationStore } from '../apps/server/src/investigation-store.ts';
import type { InvestigationSnapshot } from '../packages/contracts/src/investigation.ts';

const pilot = JSON.parse(readFileSync(new URL('../public/pilot/parcels.json', import.meta.url), 'utf8'));
const snapshot: InvestigationSnapshot = { dataset: 'pilot', releaseSha256: 'test-release', parcel: pilot.parcels[0], manifest: pilot.manifest };
const edit = { name: 'Harbourside investigation', question: 'What is established?', notes: 'No title evidence supplied.' };

test('investigation survives restart with immutable snapshot, revisions and audit', () => {
  const directory = mkdtempSync(join(tmpdir(), 'investigations-'));
  const path = join(directory, 'cases.sqlite');
  let store = createInvestigationStore(path);
  try {
    const item = store.create(edit, snapshot);
    item.snapshot.parcel.label = 'client mutation';
    assert.notEqual(store.get(item.id)!.snapshot.parcel.label, 'client mutation');
    store.update(item.id, 0, { ...edit, notes: 'Follow up required' });
    assert.throws(() => store.update(item.id, 0, edit), /Revision conflict/);
    assert.equal(store.history(item.id).length, 2);
    store.close();
    store = createInvestigationStore(path);
    assert.equal(store.get(item.id)!.notes, 'Follow up required');
    assert.equal(store.get(item.id)!.revision, 1);
    assert.deepEqual(store.get(item.id)!.snapshot, snapshot);
    assert.equal(store.list()[0].parcelId, snapshot.parcel.id);
    assert.equal(store.history(item.id).length, 2);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('failed audit write rolls back investigation changes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'investigation-failure-'));
  const path = join(directory, 'cases.sqlite');
  const store = createInvestigationStore(path);
  const external = new DatabaseSync(path);
  try {
    const item = store.create(edit, snapshot);
    external.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON investigation_events BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END;");
    assert.throws(() => store.update(item.id, 0, { ...edit, notes: 'Must not persist' }), /simulated write failure/);
    assert.deepEqual(store.get(item.id), item);
    assert.equal(store.history(item.id).length, 1);
    assert.throws(() => store.create(edit, snapshot), /simulated write failure/);
    assert.equal(store.list().length, 1);
  } finally { external.close(); store.close(); rmSync(directory, { recursive: true, force: true }); }
});