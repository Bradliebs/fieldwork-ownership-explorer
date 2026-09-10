import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireInstanceLock } from '../apps/server/src/instance-lock.ts';
import { assertRuntimeStopped } from '../apps/server/src/runtime-lock.ts';

test('second server launch returns the live instance URL without taking ownership', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fieldwork-instance-'));
  const path = join(directory, '.fieldwork-server.lock');
  try {
    const first = acquireInstanceLock(path, 'http://127.0.0.1:4317');
    assert.equal(first.acquired, true);
    const second = acquireInstanceLock(path, 'http://127.0.0.1:9999');
    assert.deepEqual(second, { acquired: false, pid: process.pid, url: 'http://127.0.0.1:4317' });
    assert.throws(() => assertRuntimeStopped(path), /server is running/);
    if (first.acquired) first.release();
    assert.equal(existsSync(path), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('server startup recovers a valid dead-PID lock and releases only its own record', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fieldwork-stale-instance-'));
  const path = join(directory, '.fieldwork-server.lock');
  try {
    writeFileSync(path, JSON.stringify({ id: 'e16d54a4-e4ec-4e5f-a80c-d92554efefb2', pid: 2_147_483_647, startedAt: '2026-09-09T12:00:00.000Z', url: 'http://127.0.0.1:4317' }));
    const instance = acquireInstanceLock(path, 'http://127.0.0.1:4318');
    assert.equal(instance.acquired, true);
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).url, 'http://127.0.0.1:4318');
    if (instance.acquired) instance.release();
    assert.equal(existsSync(path), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('server startup fails closed for a malformed lock', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fieldwork-invalid-instance-'));
  const path = join(directory, '.fieldwork-server.lock');
  try {
    writeFileSync(path, 'not-json');
    assert.throws(() => acquireInstanceLock(path, 'http://127.0.0.1:4317'), /invalid runtime lock/);
    assert.equal(existsSync(path), true);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});