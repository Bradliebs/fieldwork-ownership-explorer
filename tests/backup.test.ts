import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzipSync, zipSync } from 'fflate';
import { createDataBackup, recoverPendingRestore, restoreDataBackup, verifyDataBackup } from '../apps/server/src/backup.ts';
import { createInvestigationStore } from '../apps/server/src/investigation-store.ts';
import { acquireRuntimeLock, runtimeLockName } from '../apps/server/src/runtime-lock.ts';
import { createStore } from '../apps/server/src/store.ts';
import type { InvestigationSnapshot } from '../packages/contracts/src/investigation.ts';

const pilot = JSON.parse(readFileSync(new URL('../public/pilot/parcels.json', import.meta.url), 'utf8'));
const snapshot: InvestigationSnapshot = { dataset: 'pilot', releaseSha256: 'backup-release', parcel: pilot.parcels[0], manifest: pilot.manifest };
const backupKey = 'test-only-backup-authentication-key-1234567890';

test('verified backup restores investigations, documents and review journal with a safety archive', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fieldwork-backup-test-'));
  const sourceRoot = join(directory, 'source');
  const targetRoot = join(directory, 'target');
  const recoveredRoot = join(directory, 'recovered');
  const archivePath = join(directory, 'source.zip');
  const safetyPath = join(directory, 'pre-restore.zip');
  const recoveredSafetyPath = join(directory, 'pre-recovery.zip');
  try {
    let store = createInvestigationStore(join(sourceRoot, 'investigations.sqlite'));
    const sourceCase = store.create({ name: 'Source case', question: 'Who owns it?', notes: 'Preserve this evidence.' }, snapshot, 'source-case');
    store.addDocument(sourceCase.id, sourceCase.revision, 'evidence.txt', 'text/plain', Buffer.from('source evidence'));
    store.checkpoint({ id: 'backup-draft', sequence: 1, operationId: 'backup-operation', investigationId: sourceCase.id, baseRevision: 1,
      snapshot, edit: { name: 'Unfinished case', question: '', notes: 'Draft in backup' } });
    store.close();
    createStore(join(sourceRoot, 'demo-reviews.jsonl')).save({
      parcelId: 'DEMO-002', linkId: 'demo-link-2', revision: 0, review: 'reviewed',
      reviewer: 'Backup test', reason: 'Preserve this review', at: '2026-09-09T00:00:00.000Z',
    });

    store = createInvestigationStore(join(targetRoot, 'investigations.sqlite'));
    store.create({ name: 'Displaced case', question: 'Will this be recoverable?', notes: 'Safety copy.' }, snapshot, 'displaced-case');
    store.close();

    const manifest = await createDataBackup(sourceRoot, archivePath, backupKey);
    assert.deepEqual(manifest.files.map(file => file.path), ['data/demo-reviews.jsonl', 'data/investigations.sqlite']);
    assert.deepEqual(await verifyDataBackup(archivePath, backupKey), manifest);
    await assert.rejects(verifyDataBackup(archivePath, 'different-test-authentication-key-123456789'), /authentication failed/);

    await assert.rejects(
      restoreDataBackup(targetRoot, archivePath, backupKey, join(targetRoot, 'investigations.sqlite-wal')),
      /managed data file or SQLite sidecar/,
    );
    store = createInvestigationStore(join(targetRoot, 'investigations.sqlite'));
    try { assert.equal(store.get('displaced-case')!.notes, 'Safety copy.'); }
    finally { store.close(); }

    const restored = await restoreDataBackup(targetRoot, archivePath, backupKey, safetyPath);
    assert.equal(restored.safetyArchivePath, safetyPath);
    assert.deepEqual((await verifyDataBackup(safetyPath, backupKey)).files.map(file => file.path), ['data/investigations.sqlite']);

    store = createInvestigationStore(join(targetRoot, 'investigations.sqlite'));
    try {
      assert.equal(store.get('displaced-case'), undefined);
      assert.equal(store.get('source-case')!.notes, 'Preserve this evidence.');
      const document = store.get('source-case')!.documents[0];
      assert.equal(store.document('source-case', document.id)!.content.toString(), 'source evidence');
      assert.equal(store.drafts()[0].edit.notes, 'Draft in backup');
    } finally { store.close(); }
    assert.equal(createStore(join(targetRoot, 'demo-reviews.jsonl')).parcels[1].links[0].review, 'reviewed');

    await restoreDataBackup(recoveredRoot, safetyPath, backupKey, recoveredSafetyPath);
    store = createInvestigationStore(join(recoveredRoot, 'investigations.sqlite'));
    try { assert.equal(store.get('displaced-case')!.notes, 'Safety copy.'); }
    finally { store.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('backup verification rejects checksum-tampered contents', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fieldwork-backup-tamper-'));
  const dataRoot = join(directory, 'data');
  const targetRoot = join(directory, 'target');
  const archivePath = join(directory, 'valid.zip');
  const tamperedPath = join(directory, 'tampered.zip');
  const safetyPath = join(directory, 'safety.zip');
  try {
    let store = createInvestigationStore(join(dataRoot, 'investigations.sqlite'));
    store.close();
    await createDataBackup(dataRoot, archivePath, backupKey);
    const entries = unzipSync(readFileSync(archivePath));
    entries['data/investigations.sqlite'][100] ^= 1;
    writeFileSync(tamperedPath, zipSync(entries));
    await assert.rejects(verifyDataBackup(tamperedPath, backupKey), /Backup file verification failed/);

    entries['data/investigations.sqlite'][100] ^= 1;
    entries['unexpected.txt'] = Buffer.from('not allowed');
    writeFileSync(join(directory, 'unexpected.zip'), zipSync(entries));
    await assert.rejects(verifyDataBackup(join(directory, 'unexpected.zip'), backupKey), /contents do not match its manifest/);

    store = createInvestigationStore(join(targetRoot, 'investigations.sqlite'));
    store.create({ name: 'Live case', question: 'Will this survive?', notes: 'Do not replace.' }, snapshot, 'live-case');
    store.close();
    await assert.rejects(restoreDataBackup(targetRoot, tamperedPath, backupKey, safetyPath), /Backup file verification failed/);
    store = createInvestigationStore(join(targetRoot, 'investigations.sqlite'));
    try { assert.equal(store.get('live-case')!.notes, 'Do not replace.'); }
    finally { store.close(); }
    assert.equal(existsSync(safetyPath), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('backup refuses to run while the data directory is locked', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fieldwork-backup-lock-'));
  const release = acquireRuntimeLock(join(directory, runtimeLockName));
  try {
    await assert.rejects(createDataBackup(directory, join(directory, 'backup.zip'), backupKey), /server is running/);
  } finally { release(); rmSync(directory, { recursive: true, force: true }); }
});

test('backup rejects managed SQLite paths and releases its lock after pending restore refusal', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fieldwork-backup-paths-'));
  try {
    const store = createInvestigationStore(join(directory, 'investigations.sqlite'));
    store.close();
    for (const name of [
      'investigations.sqlite',
      'investigations.sqlite-journal',
      'investigations.sqlite-wal',
      'investigations.sqlite-shm',
      'demo-reviews.jsonl',
    ]) {
      await assert.rejects(createDataBackup(directory, join(directory, name), backupKey), /managed data file or SQLite sidecar/);
      assert.equal(existsSync(join(directory, runtimeLockName)), false);
    }

    const pendingPath = join(directory, '.fieldwork-restore-pending');
    mkdirSync(pendingPath);
    await assert.rejects(createDataBackup(directory, join(directory, 'backup.zip'), backupKey), /Incomplete data restore requires recovery/);
    assert.equal(existsSync(join(directory, runtimeLockName)), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('incomplete restore recovery reinstates the durable original database', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fieldwork-recovery-'));
  const databasePath = join(directory, 'investigations.sqlite');
  const transactionPath = join(directory, '.fieldwork-restore-test');
  const rollbackRoot = join(transactionPath, 'original');
  const safetyArchivePath = join(directory, 'safety.zip');
  try {
    let store = createInvestigationStore(databasePath);
    store.create({ name: 'Original case', question: 'Recover me?', notes: 'Durable original.' }, snapshot, 'original-case');
    store.close();
    mkdirSync(rollbackRoot, { recursive: true });
    renameSync(databasePath, join(rollbackRoot, 'investigations.sqlite'));

    store = createInvestigationStore(databasePath);
    store.create({ name: 'Replacement case', question: 'Was this committed?', notes: 'Incomplete replacement.' }, snapshot, 'replacement-case');
    store.close();
    writeFileSync(join(transactionPath, 'restore.json'), JSON.stringify({
      archivePath: join(directory, 'incoming.zip'),
      safetyArchivePath,
      createdAt: '2026-09-09T00:00:00.000Z',
      originalFiles: ['investigations.sqlite'],
      state: 'replacing',
    }));

    const result = await recoverPendingRestore(directory);
    assert.equal(result.restoredOriginals, true);
    assert.equal(result.safetyArchivePath, safetyArchivePath);
    assert.equal(existsSync(transactionPath), false);
    store = createInvestigationStore(databasePath);
    try {
      assert.equal(store.get('replacement-case'), undefined);
      assert.equal(store.get('original-case')!.notes, 'Durable original.');
    } finally { store.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('committed restore recovery keeps the complete replacement set', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fieldwork-committed-recovery-'));
  const databasePath = join(directory, 'investigations.sqlite');
  const transactionPath = join(directory, '.fieldwork-restore-test');
  const rollbackRoot = join(transactionPath, 'original');
  try {
    let store = createInvestigationStore(databasePath);
    store.create({ name: 'Original case', question: 'Old state?', notes: 'Original.' }, snapshot, 'original-case');
    store.close();
    mkdirSync(rollbackRoot, { recursive: true });
    renameSync(databasePath, join(rollbackRoot, 'investigations.sqlite'));

    store = createInvestigationStore(databasePath);
    store.create({ name: 'Replacement case', question: 'Committed state?', notes: 'Keep replacement.' }, snapshot, 'replacement-case');
    store.close();
    writeFileSync(join(transactionPath, 'restore.json'), JSON.stringify({
      archivePath: join(directory, 'incoming.zip'),
      safetyArchivePath: join(directory, 'safety.zip'),
      createdAt: '2026-09-09T00:00:00.000Z',
      originalFiles: ['investigations.sqlite', 'demo-reviews.jsonl'],
      state: 'committed',
    }));

    const result = await recoverPendingRestore(directory);
    assert.equal(result.restoredOriginals, false);
    assert.equal(existsSync(transactionPath), false);
    store = createInvestigationStore(databasePath);
    try {
      assert.equal(store.get('original-case'), undefined);
      assert.equal(store.get('replacement-case')!.notes, 'Keep replacement.');
    } finally { store.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});