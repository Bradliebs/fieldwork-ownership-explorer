import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { monitorShutdownRequest } from '../apps/server/src/shutdown-request.ts';

test('shutdown monitor ignores stale instances and accepts the current instance once', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'shutdown-request-'));
  const path = join(directory, '.fieldwork-shutdown-request.json');
  const instanceId = randomUUID();
  let requests = 0;
  const stop = monitorShutdownRequest(path, instanceId, () => requests++, 10);
  try {
    writeFileSync(path, JSON.stringify({ instanceId: randomUUID(), requestedAt: new Date().toISOString() }));
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(requests, 0);
    writeFileSync(path, JSON.stringify({ instanceId, requestedAt: new Date().toISOString() }));
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(requests, 1);
    writeFileSync(path, JSON.stringify({ instanceId, requestedAt: new Date().toISOString() }));
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(requests, 1);
  } finally {
    stop();
    rmSync(directory, { recursive: true, force: true });
  }
});