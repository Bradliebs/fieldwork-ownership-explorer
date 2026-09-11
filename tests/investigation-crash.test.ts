import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createInvestigationStore } from '../apps/server/src/investigation-store.ts';
import type { Investigation, InvestigationSnapshot } from '../packages/contracts/src/investigation.ts';

const pilot = JSON.parse(readFileSync(new URL('../public/pilot/parcels.json', import.meta.url), 'utf8'));
const snapshot: InvestigationSnapshot = { dataset: 'pilot', releaseSha256: 'test-release', parcel: pilot.parcels[0], manifest: pilot.manifest };
const edit = { name: 'Baseline case', question: 'What survives a crash?', notes: 'Already committed' };
const worker = fileURLToPath(new URL('./fixtures/investigation-crash-worker.ts', import.meta.url));

async function terminateAtCommit(path: string, operation: string, boundary: string) {
  const child = spawn(process.execPath, [worker, path, operation, boundary], {
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let stderr = '';
  let stdout = '';
  let reachedBoundary = false;
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, 15_000);
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
      if (!reachedBoundary && stdout.includes(`paused:${boundary}\n`)) {
        reachedBoundary = true;
        child.kill('SIGKILL');
      }
    });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
  });
  assert.ok(reachedBoundary, `Child failed to reach ${boundary} commit: ${stderr}`);
  assert.ok(result.signal === 'SIGKILL' || (result.code !== null && result.code !== 0), 'Child must be forcibly terminated');
}

for (const operation of ['create', 'update', 'document']) {
  for (const boundary of ['before', 'after']) {
    test(`forced termination ${boundary} ${operation} commit recovers a complete revision`, { timeout: 25_000 }, async () => {
      const directory = mkdtempSync(join(tmpdir(), 'fieldwork-crash-'));
      const path = join(directory, 'cases.sqlite');
      let store: ReturnType<typeof createInvestigationStore> | undefined = createInvestigationStore(path);
      try {
        const baseline = store.create(edit, snapshot, 'baseline');
        const originalBytes = Buffer.from('Existing evidence must survive');
        const saved = store.addDocument(baseline.id, 0, 'baseline.txt', 'text/plain', originalBytes);
        const originalHistory = store.history(baseline.id);
        store.close();
        store = undefined;
        await terminateAtCommit(path, operation, boundary);
        store = createInvestigationStore(path);
        const committed = boundary === 'after';
        const current = store.get(baseline.id)!;
        if (!committed || operation === 'create') {
          assert.deepEqual(current, saved);
          assert.deepEqual(store.history(baseline.id), originalHistory);
        } else {
          assert.equal(current.revision, 2);
          assert.deepEqual(current.snapshot, saved.snapshot);
          assert.deepEqual(store.history(baseline.id).map(event => [event.revision, event.action]), [
            [2, operation === 'update' ? 'updated' : 'document added'], [1, 'document added'], [0, 'created'],
          ]);
          assert.equal(current.notes, operation === 'update' ? 'Changed by child process' : edit.notes);
          assert.equal(current.documents.length, operation === 'document' ? 2 : 1);
        }
        const created = store.get('created-by-child');
        assert.equal(store.list().length, committed && operation === 'create' ? 2 : 1);
        if (committed && operation === 'create') {
          assert.ok(created);
          assert.equal(created.revision, 0);
          assert.equal(created.notes, 'Changed by child process');
          assert.deepEqual(created.snapshot, snapshot);
          assert.deepEqual(store.history(created.id).map(event => event.action), ['created']);
        } else {
          assert.equal(created, undefined);
          assert.deepEqual(store.history('created-by-child'), []);
        }
        assert.deepEqual(store.document(baseline.id, saved.documents[0].id)!.content, originalBytes);
        if (committed && operation === 'document') {
          const document = current.documents.find(item => item.name === 'large-evidence.txt')!;
          const expected = Buffer.alloc(3_000_000, 65);
          assert.equal(document.size, expected.length);
          assert.equal(document.sha256, createHash('sha256').update(expected).digest('hex'));
          assert.deepEqual(store.document(baseline.id, document.id)!.content, expected);
        }
        const database = new DatabaseSync(path);
        try {
          assert.equal(database.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok');
          assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
          assert.equal(database.prepare('SELECT COUNT(*) AS count FROM investigation_documents').get()!.count, committed && operation === 'document' ? 2 : 1);
          for (const item of store.list()) {
            const latest = database.prepare('SELECT notes, workflow, documents FROM investigation_events WHERE investigation_id = ? AND revision = ?').get(item.id, item.revision)!;
            const record: Investigation = store.get(item.id)!;
            assert.equal(latest.notes, record.notes);
            assert.deepEqual(JSON.parse(String(latest.workflow)), record.workflow);
            assert.deepEqual(JSON.parse(String(latest.documents)), record.documents);
          }
        } finally { database.close(); }
        const next = store.update(baseline.id, current.revision, { ...edit, notes: 'Writable after recovery' });
        store.close();
        store = undefined;
        store = createInvestigationStore(path);
        assert.deepEqual(store.get(baseline.id), next);
      } finally {
        try { store?.close(); }
        finally { rmSync(directory, { recursive: true, force: true }); }
      }
    });
  }
}