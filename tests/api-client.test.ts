import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, api } from '../apps/web/src/api.ts';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test('API client returns parsed JSON responses', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ ready: true }), {
    headers: { 'Content-Type': 'application/json' },
  });

  assert.deepEqual(await api<{ ready: boolean }>('/api/health'), { ready: true });
});

test('API client preserves a structured service error', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Database is unavailable' }), {
    status: 503, headers: { 'Content-Type': 'application/json' },
  });

  await assert.rejects(api('/api/investigations'), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.message, 'Database is unavailable');
    assert.equal(error.status, 503);
    assert.equal(error.kind, 'response');
    assert.equal(error.category, 'storage-unavailable');
    return true;
  });
});

test('API client normalizes non-JSON and malformed responses', async () => {
  globalThis.fetch = async () => new Response('Service unavailable', { status: 502 });
  await assert.rejects(api('/api/session'), { message: 'The local service could not complete the request.' });

  globalThis.fetch = async () => new Response('<html>unexpected</html>');
  await assert.rejects(api('/api/session'), { message: 'The local service returned an invalid response. Reload records and try again.' });
});

test('API client normalizes connection failures', async () => {
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };

  await assert.rejects(api('/api/session'), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.message, 'Unable to reach the local service. Check that Fieldwork is running.');
    assert.equal(error.status, 0);
    assert.equal(error.kind, 'network');
    assert.equal(error.category, 'network');
    return true;
  });
});

test('API client distinguishes validation, conflicts and release mismatches', async () => {
  for (const [status, message, expected] of [
    [400, 'Invalid document encoding', 'validation'],
    [409, 'This investigation changed in another window.', 'revision-conflict'],
    [409, 'Source release changed. Reload the parcel.', 'release-mismatch'],
  ] as const) {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: message }), { status });
    await assert.rejects(api('/api/test', { retry: 'never' }), (error: unknown) => error instanceof ApiError && error.category === expected);
  }
});

test('API client retries reads and operation-ID-safe writes only once', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return calls % 2 === 1 ? new Response('{}', { status: 503 }) : new Response(JSON.stringify({ ok: true }));
  };
  assert.deepEqual(await api('/api/health'), { ok: true });
  assert.equal(calls, 2);
  assert.deepEqual(await api('/api/investigations', { method: 'POST', retry: 'operation-id' }), { ok: true });
  assert.equal(calls, 4);

  globalThis.fetch = async () => { calls++; return new Response('{}', { status: 503 }); };
  await assert.rejects(api('/api/reviews', { method: 'POST' }), (error: unknown) => error instanceof ApiError && error.category === 'storage-unavailable');
  assert.equal(calls, 5);
});