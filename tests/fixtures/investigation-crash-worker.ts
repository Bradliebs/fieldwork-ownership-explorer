import { DatabaseSync } from 'node:sqlite';
import { writeSync } from 'node:fs';
import { createInvestigationStore } from '../../apps/server/src/investigation-store.ts';

const [path, operation, boundary] = process.argv.slice(2);
if (!path || !['create', 'update', 'document'].includes(operation) || !['before', 'after'].includes(boundary)) {
  throw new Error('Expected disposable database path, operation and commit boundary');
}
const store = createInvestigationStore(path);
const baseline = store.get('baseline')!;
const originalExec = DatabaseSync.prototype.exec;
function pauseForTermination() {
  writeSync(1, `paused:${boundary}\n`);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  throw new Error('Crash barrier unexpectedly resumed');
}
DatabaseSync.prototype.exec = function (sql: string) {
  if (sql === 'COMMIT' && boundary === 'before') pauseForTermination();
  const result = originalExec.call(this, sql);
  if (sql === 'COMMIT' && boundary === 'after') pauseForTermination();
  return result;
};
const edit = { name: 'Crash recovery case', question: 'Does the whole write survive?', notes: 'Changed by child process' };
if (operation === 'create') store.create(edit, baseline.snapshot, 'created-by-child');
if (operation === 'update') store.update(baseline.id, baseline.revision, edit);
if (operation === 'document') store.addDocument(baseline.id, baseline.revision, 'large-evidence.txt', 'text/plain', Buffer.alloc(3_000_000, 65));
throw new Error('Write completed without reaching the crash barrier');