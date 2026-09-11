import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

async function availablePort(): Promise<number> {
  const reservation = createServer();
  return new Promise((resolve, reject) => {
    reservation.once('error', reject);
    reservation.listen(0, '127.0.0.1', () => {
      const address = reservation.address();
      assert.ok(address && typeof address !== 'string');
      reservation.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}

function launch(dataRoot: string, port: number) {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../apps/server/src/main.ts', import.meta.url))], {
    env: { ...process.env, PORT: String(port), FIELDWORK_DATA_DIR: dataRoot,
      FIELDWORK_ASSET_DIR: fileURLToPath(new URL('../public', import.meta.url)) },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let output = '';
  let failure: Error | undefined;
  child.once('error', error => { failure = error; });
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => {
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Server startup timed out: ${output}`));
    }, 15_000);
    child.stderr.on('data', chunk => { output += chunk.toString(); });
    child.stdout.on('data', chunk => {
      output += chunk.toString();
      if (output.includes(`Ownership Explorer: http://127.0.0.1:${port}`)) {
        clearTimeout(timer);
        resolve();
      }
    });
    void closed.then(() => { clearTimeout(timer); reject(failure ?? new Error(`Server exited before readiness: ${output}`)); });
  });
  return { child, closed, ready };
}

test('real HTTP server reclaims a crash lock and preserves saved cases and evidence', { timeout: 45_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fieldwork-server-restart-'));
  const port = await availablePort();
  const base = `http://127.0.0.1:${port}`;
  const lockPath = join(directory, '.fieldwork-server.lock');
  const servers: ReturnType<typeof launch>[] = [];
  const request = (path: string, init?: RequestInit) => fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(5_000) });
  try {
    const first = launch(directory, port);
    servers.push(first);
    await first.ready;
    const firstLock = JSON.parse(readFileSync(lockPath, 'utf8'));
    assert.equal(firstLock.pid, first.child.pid);
    const session = await (await request('/api/session')).json();
    const headers = { 'content-type': 'application/json', 'x-local-token': session.token };
    const pilot = await (await request('/api/pilot-parcels')).json();
    const release = await (await request('/api/pilot-release')).json();
    const edit = { name: 'Restart recovery case', question: 'Is saved evidence intact?', notes: 'Fictional saved baseline' };
    const created = await request('/api/investigations', { method: 'POST', headers, body: JSON.stringify({
      ...edit, parcelId: pilot.parcels[0].id, published: pilot.manifest.published, operationId: randomUUID(),
    }) });
    assert.equal(created.status, 201);
    const endpoint = `/api/investigations/${(await created.json()).investigation.id}`;
    const bytes = Buffer.from('Fictional evidence saved before forced server termination.');
    const upload = await request(`${endpoint}/documents`, { method: 'POST', headers, body: JSON.stringify({
      revision: 0, name: 'restart-evidence.txt', mediaType: 'text/plain', base64: bytes.toString('base64'),
    }) });
    assert.equal(upload.status, 200);
    const saved = await upload.json();
    assert.equal(saved.investigation.revision, 1);
    assert.equal(first.child.kill('SIGKILL'), true);
    const crash = await first.closed;
    assert.ok(crash.signal === 'SIGKILL' || (crash.code !== null && crash.code !== 0));
    assert.deepEqual(JSON.parse(readFileSync(lockPath, 'utf8')), firstLock);

    const second = launch(directory, port);
    servers.push(second);
    await second.ready;
    const secondLock = JSON.parse(readFileSync(lockPath, 'utf8'));
    assert.equal(secondLock.pid, second.child.pid);
    assert.notEqual(secondLock.id, firstLock.id);
    assert.equal((await request('/api/status')).status, 200);
    assert.deepEqual(await (await request('/api/pilot-release')).json(), release);
    const reopened = await request(endpoint);
    assert.equal(reopened.status, 200);
    assert.deepEqual(await reopened.json(), saved);
    const document = saved.investigation.documents[0];
    const download = await request(`${endpoint}/documents/${document.id}`);
    assert.equal(download.status, 200);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
    assert.equal(document.sha256, createHash('sha256').update(bytes).digest('hex'));
    const report = await request(`${endpoint}/report`);
    assert.equal(report.status, 200);
    assert.match(await report.text(), /Saved revision 1/);
    const payload = JSON.stringify({ ...edit, revision: 1, notes: 'Saved after server restart' });
    assert.equal((await request(endpoint, { method: 'PUT', headers, body: payload })).status, 403);
    const newSession = await (await request('/api/session')).json();
    assert.notEqual(newSession.token, session.token);
    const update = await request(endpoint, { method: 'PUT', headers: { ...headers, 'x-local-token': newSession.token }, body: payload });
    assert.equal(update.status, 200);
    const updated = await update.json();
    assert.equal(updated.investigation.revision, 2);
    assert.equal(updated.history.length, 3);

    writeFileSync(join(directory, '.fieldwork-shutdown-request.json'), JSON.stringify({ instanceId: secondLock.id, requestedAt: new Date().toISOString() }));
    const stopTimer = setTimeout(() => second.child.kill('SIGKILL'), 10_000);
    try { assert.deepEqual(await second.closed, { code: 0, signal: null }); }
    finally { clearTimeout(stopTimer); }
    assert.equal(existsSync(lockPath), false);

    const third = launch(directory, port);
    servers.push(third);
    await third.ready;
    assert.deepEqual(await (await request(endpoint)).json(), updated);
  } finally {
    for (const server of servers) {
      if (server.child.exitCode === null && server.child.signalCode === null) server.child.kill('SIGKILL');
      await server.closed;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});