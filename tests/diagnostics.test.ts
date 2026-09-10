import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServer } from '../apps/server/src/server.ts';
import { investigationSchemaVersion } from '../apps/server/src/investigation-migrations.ts';

const headers = { host: '127.0.0.1:4317' };

test('health and diagnostics expose only operational facts', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fieldwork-diagnostics-'));
  const logPath = join(directory, 'logs', 'fieldwork.jsonl');
  const app = buildServer({
    port: 4317, dataRoot: directory, investigationDb: join(directory, 'cases.sqlite'),
    logPath, releaseId: 'test-release',
  });
  try {
    assert.deepEqual((await app.inject({ url: '/api/health', headers })).json(), { status: 'ok' });
    const facts = (await app.inject({ url: '/api/diagnostics', headers })).json();
    assert.equal(facts.releaseId, 'test-release');
    assert.equal(facts.schemaVersion, investigationSchemaVersion);
    assert.equal(facts.storage.writable, true);
    assert.equal(facts.database.integrity, 'ok');
    assert.equal(facts.lastBackup, null);
    assert.equal(facts.log.path, logPath);

    const session = (await app.inject({ url: '/api/session', headers })).json();
    await app.inject({
      method: 'POST', url: '/api/reviews',
      headers: { ...headers, 'x-local-token': session.token },
      payload: { parcelId: 'SECRET-PARCEL', linkId: 'SECRET-LINK', revision: 0, review: 'reviewed', reviewer: 'SECRET-NAME', reason: 'SECRET-NOTES' },
    });
    await app.inject({ url: '/api/export?ids=SECRET-QUERY', headers });
    const exported = (await app.inject({ url: '/api/diagnostics/export', headers })).json();
    assert.equal(exported.diagnostics.releaseId, 'test-release');
    assert.ok(exported.logs.length >= 5);
    for (const entry of exported.logs) {
      assert.deepEqual(Object.keys(entry).sort(), ['applicationVersion', 'at', 'durationMs', 'errorCode', 'event', 'releaseId', 'requestId', 'route', 'schemaVersion', 'status'].sort());
    }
    const serialized = `${readFileSync(logPath, 'utf8')}\n${JSON.stringify(exported)}`;
    for (const secret of ['SECRET-PARCEL', 'SECRET-LINK', 'SECRET-NAME', 'SECRET-NOTES', 'SECRET-QUERY', session.token]) assert.doesNotMatch(serialized, new RegExp(secret));
  } finally { await app.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('diagnostic routes retain exact Host and Origin protection', async () => {
  const app = buildServer({ port: 4317 });
  try {
    assert.equal((await app.inject({ url: '/api/health', headers: { host: 'evil.example' } })).statusCode, 403);
    assert.equal((await app.inject({ url: '/api/diagnostics', headers: { ...headers, origin: 'https://evil.example' } })).statusCode, 403);
  } finally { await app.close(); }
});