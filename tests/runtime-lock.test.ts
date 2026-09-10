import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireRuntimeLock, assertNoPendingRestore, assertRuntimeStopped, restoreTransactionPrefix } from '../apps/server/src/runtime-lock.ts';

test('runtime lock blocks concurrent data management and releases idempotently', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fieldwork-lock-'));
  const path = join(directory, '.fieldwork-server.lock');
  try {
    const release = acquireRuntimeLock(path);
    assert.equal(existsSync(path), true);
    assert.throws(() => assertRuntimeStopped(path), new RegExp(`server is running with PID ${process.pid}`));
    assert.throws(() => acquireRuntimeLock(path), /server is running/);
    release();
    release();
    assert.equal(existsSync(path), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('runtime lock fails closed for stale and malformed crash records', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fieldwork-stale-lock-'));
  const path = join(directory, '.fieldwork-server.lock');
  try {
    writeFileSync(path, JSON.stringify({ id: 'e16d54a4-e4ec-4e5f-a80c-d92554efefb2', pid: 2_147_483_647, startedAt: '2026-09-09' }));
    assert.throws(() => assertRuntimeStopped(path), /stale or invalid runtime lock/);
    assert.equal(existsSync(path), true);
    rmSync(path);
    writeFileSync(path, 'not-json');
    assert.throws(() => assertRuntimeStopped(path), /stale or invalid runtime lock/);
    assert.equal(existsSync(path), true);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('server startup rejects an incomplete restore transaction', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fieldwork-pending-restore-'));
  try {
    mkdirSync(join(directory, `${restoreTransactionPrefix}test`));
    assert.throws(() => assertNoPendingRestore(directory), /Incomplete data restore requires recovery/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});