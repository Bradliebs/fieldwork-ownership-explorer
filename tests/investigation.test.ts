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

test('migration history is checksummed, adopted and idempotent', () => {
  const directory = mkdtempSync(join(tmpdir(), 'investigation-migrations-'));
  const path = join(directory, 'cases.sqlite');
  let store = createInvestigationStore(path);
  store.close();
  try {
    let database = new DatabaseSync(path);
    try {
      const recorded = database.prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version').all();
      assert.deepEqual(recorded.map(row => [String(row.name), String(row.checksum)]), [
        ['investigations', '6711b4e776e91784240775f58094302b4905b5967bcbf29de99aafec8ba16b72'],
        ['consent-and-documents', 'df224178392c1981aaad5289b2eb722ec9a7c3ceeed687d3165321cfc77eee57'],
        ['recovery-drafts', '51dddc80e1e16a3290c0aea648fb624764d244de641f4901cf0a8fe1bdce7766'],
      ]);
      database.exec('DROP TABLE schema_migrations');
    } finally { database.close(); }

    store = createInvestigationStore(path);
    store.close();
    database = new DatabaseSync(path);
    try { assert.equal(database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get()!.count, 3); }
    finally { database.close(); }

    store = createInvestigationStore(path);
    store.close();
    database = new DatabaseSync(path);
    try { database.prepare('DELETE FROM schema_migrations WHERE version = 2').run(); }
    finally { database.close(); }
    assert.throws(() => createInvestigationStore(path), /migration history is incomplete/);

    database = new DatabaseSync(path);
    try {
      database.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?, ?)').run(2, 'consent-and-documents', 'tampered', new Date().toISOString());
    } finally { database.close(); }
    assert.throws(() => createInvestigationStore(path), /migration history is incompatible/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('ledger-backed databases require canonical history and physical schemas', () => {
  const directory = mkdtempSync(join(tmpdir(), 'investigation-ledger-schema-'));
  const malformedLedgerPath = join(directory, 'malformed-ledger.sqlite');
  const missingForeignKeyPath = join(directory, 'missing-foreign-key.sqlite');
  const falseVersionPath = join(directory, 'false-version.sqlite');
  try {
    let store = createInvestigationStore(malformedLedgerPath);
    store.close();
    let database = new DatabaseSync(malformedLedgerPath);
    try {
      database.exec(`ALTER TABLE schema_migrations RENAME TO original_schema_migrations;
        CREATE TABLE schema_migrations (
          version INTEGER NOT NULL, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL
        );
        INSERT INTO schema_migrations SELECT * FROM original_schema_migrations WHERE version = 1;
        INSERT INTO schema_migrations SELECT * FROM original_schema_migrations WHERE version = 1;
        DROP TABLE original_schema_migrations;`);
    } finally { database.close(); }
    assert.throws(() => createInvestigationStore(malformedLedgerPath), /migration history schema is incompatible/);

    store = createInvestigationStore(missingForeignKeyPath);
    store.close();
    database = new DatabaseSync(missingForeignKeyPath);
    try {
      database.exec(`PRAGMA foreign_keys = OFF;
        ALTER TABLE investigation_documents RENAME TO original_investigation_documents;
        CREATE TABLE investigation_documents (
          id TEXT PRIMARY KEY, investigation_id TEXT NOT NULL,
          name TEXT NOT NULL, media_type TEXT NOT NULL, size INTEGER NOT NULL,
          sha256 TEXT NOT NULL, uploaded_at TEXT NOT NULL, content BLOB NOT NULL
        );
        DROP TABLE original_investigation_documents;`);
    } finally { database.close(); }
    assert.throws(() => createInvestigationStore(missingForeignKeyPath), /schema does not match its version/);

    database = new DatabaseSync(falseVersionPath);
    try {
      database.exec(`CREATE TABLE investigations (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, question TEXT NOT NULL, notes TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK(revision >= 0), created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL, snapshot TEXT NOT NULL
        );
        CREATE TABLE investigation_events (
          investigation_id TEXT NOT NULL REFERENCES investigations(id),
          revision INTEGER NOT NULL, action TEXT NOT NULL, at TEXT NOT NULL,
          name TEXT NOT NULL, question TEXT NOT NULL, notes TEXT NOT NULL,
          PRIMARY KEY(investigation_id, revision)
        );
        CREATE TABLE schema_migrations (
          version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL
        );
        INSERT INTO schema_migrations VALUES
          (1, 'investigations', '6711b4e776e91784240775f58094302b4905b5967bcbf29de99aafec8ba16b72', '2026-09-09'),
          (2, 'consent-and-documents', 'df224178392c1981aaad5289b2eb722ec9a7c3ceeed687d3165321cfc77eee57', '2026-09-09');
        PRAGMA user_version = 2;`);
    } finally { database.close(); }
    assert.throws(() => createInvestigationStore(falseVersionPath), /schema does not match its version/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('newer investigation database versions are rejected', () => {
  const directory = mkdtempSync(join(tmpdir(), 'investigation-version-'));
  const path = join(directory, 'cases.sqlite');
  const database = new DatabaseSync(path);
  try {
    database.exec('PRAGMA user_version = 99');
  } finally { database.close(); }
  try {
    assert.throws(() => createInvestigationStore(path), /Unsupported investigation database version/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('database startup rejects broken document references', () => {
  const directory = mkdtempSync(join(tmpdir(), 'investigation-integrity-'));
  const path = join(directory, 'cases.sqlite');
  const store = createInvestigationStore(path);
  store.close();
  const database = new DatabaseSync(path);
  try {
    database.exec('PRAGMA foreign_keys = OFF');
    database.prepare('INSERT INTO investigation_documents VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run('document-id', 'missing-investigation', 'orphan.txt', 'text/plain', 6, 'checksum', '2026-09-09T00:00:00.000Z', Buffer.from('orphan'));
  } finally { database.close(); }
  try {
    assert.throws(() => createInvestigationStore(path), /foreign key check failed/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('failed schema migration rolls back and can be retried', () => {
  const directory = mkdtempSync(join(tmpdir(), 'investigation-migration-failure-'));
  const path = join(directory, 'cases.sqlite');
  const caseId = 'migration-case';
  let database = new DatabaseSync(path);
  try {
    database.exec(`CREATE TABLE investigations (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, question TEXT NOT NULL, notes TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK(revision >= 0), created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL, snapshot TEXT NOT NULL
      );
      CREATE TABLE investigation_events (
        investigation_id TEXT NOT NULL REFERENCES investigations(id),
        revision INTEGER NOT NULL, action TEXT NOT NULL, at TEXT NOT NULL,
        name TEXT NOT NULL, question TEXT NOT NULL, notes TEXT NOT NULL,
        PRIMARY KEY(investigation_id, revision)
      );
      CREATE TABLE investigation_documents (conflict TEXT);
      PRAGMA user_version = 1;`);
    database.prepare('INSERT INTO investigations VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(caseId, edit.name, edit.question, edit.notes, 0, '2026-09-09', '2026-09-09', JSON.stringify(snapshot));
  } finally { database.close(); }

  try {
    assert.throws(() => createInvestigationStore(path), /already exists/);
    database = new DatabaseSync(path);
    try {
      assert.equal(database.prepare('PRAGMA user_version').get()!.user_version, 1);
      assert.equal(database.prepare('SELECT notes FROM investigations WHERE id = ?').get(caseId)!.notes, edit.notes);
      assert.equal(database.prepare("SELECT COUNT(*) AS count FROM pragma_table_info('investigations') WHERE name = 'workflow'").get()!.count, 0);
      database.exec('DROP TABLE investigation_documents');
    } finally { database.close(); }

    const store = createInvestigationStore(path);
    try {
      assert.equal(store.get(caseId)!.notes, edit.notes);
      assert.equal(store.get(caseId)!.revision, 0);
    } finally { store.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('claimed legacy schema versions are validated before adoption', () => {
  const directory = mkdtempSync(join(tmpdir(), 'investigation-legacy-schema-'));
  const path = join(directory, 'cases.sqlite');
  let database = new DatabaseSync(path);
  try { database.exec('PRAGMA user_version = 2'); }
  finally { database.close(); }
  try {
    assert.throws(() => createInvestigationStore(path), /schema does not match its version/);

    const reorderedPath = join(directory, 'reordered.sqlite');
    database = new DatabaseSync(reorderedPath);
    try {
      database.exec(`CREATE TABLE investigations (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, question TEXT NOT NULL, notes TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK(revision >= 0), created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL, workflow TEXT NOT NULL, snapshot TEXT NOT NULL
        );
        CREATE TABLE investigation_events (
          investigation_id TEXT NOT NULL REFERENCES investigations(id),
          revision INTEGER NOT NULL, action TEXT NOT NULL, at TEXT NOT NULL,
          name TEXT NOT NULL, question TEXT NOT NULL, notes TEXT NOT NULL,
          workflow TEXT NOT NULL, documents TEXT NOT NULL,
          PRIMARY KEY(investigation_id, revision)
        );
        CREATE TABLE investigation_documents (
          id TEXT PRIMARY KEY, investigation_id TEXT NOT NULL REFERENCES investigations(id),
          name TEXT NOT NULL, media_type TEXT NOT NULL, size INTEGER NOT NULL,
          sha256 TEXT NOT NULL, uploaded_at TEXT NOT NULL, content BLOB NOT NULL
        );
        PRAGMA user_version = 2;`);
    } finally { database.close(); }
    assert.throws(() => createInvestigationStore(reorderedPath), /schema does not match its version/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});