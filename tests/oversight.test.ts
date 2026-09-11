import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { emptyWorkflow, type PermissionRecord } from '../packages/contracts/src/consent.ts';
import { caseOversight } from '../packages/contracts/src/oversight.ts';
import type { Investigation } from '../packages/contracts/src/investigation.ts';
import { buildServer } from '../apps/server/src/server.ts';

const pilot = JSON.parse(readFileSync(new URL('../public/pilot/parcels.json', import.meta.url), 'utf8'));

test('oversight distinguishes empty cases, unknown dates, expiry boundaries and retention review dates', () => {
  const item: Investigation = { id: randomUUID(), name: 'Oversight', question: '', notes: '', revision: 0, createdAt: '', updatedAt: '', documents: [],
    snapshot: { dataset: 'pilot', parcel: pilot.parcels[0], manifest: pilot.manifest, releaseSha256: 'source' }, workflow: emptyWorkflow() };
  const empty = caseOversight(item, '2026-09-11');
  assert.equal(empty.requestCount, 0);
  assert.equal(empty.retention.state, 'not recorded');
  assert.equal(empty.needsAttention, true);
  const permission: PermissionRecord = { id: randomUUID(), partyId: randomUUID(), activities: 'Survey', landScope: 'Plan', status: 'granted', requestedOn: '', responseOn: '', validFrom: '2026-09-01', validUntil: '2026-09-11', conditions: '', signatory: '', evidenceRef: '' };
  item.workflow.consents = [permission, { ...permission, id: randomUUID(), validUntil: '2026-09-10' }, { ...permission, id: randomUUID(), validUntil: '2026-10-11' }, { ...permission, id: randomUUID(), validUntil: '2026-10-12' }, { ...permission, id: randomUUID(), status: 'awaiting response', validFrom: '', validUntil: '' }];
  item.workflow.retentionReviewOn = '2026-09-11';
  const current = caseOversight(item, '2026-09-11');
  assert.equal(current.expiring.length, 2);
  assert.deepEqual(current.unresolved.map(request => request.state), ['expired', 'awaiting response']);
  assert.equal(current.missingValidityDates, 1);
  assert.equal(current.retention.state, 'due');
  item.workflow.retentionReviewOn = '2026-09-12';
  assert.equal(caseOversight(item, '2026-09-11').retention.state, 'upcoming');
});

test('oversight API excludes notes, contact routes and source geometry and remains no-store', async () => {
  const app = buildServer({ port: 4317 });
  const headers = { host: '127.0.0.1:4317' };
  try {
    const { token } = (await app.inject({ url: '/api/session', headers })).json();
    const created = await app.inject({ method: 'POST', url: '/api/investigations', headers: { ...headers, 'x-local-token': token }, payload: { name: 'Review case', question: 'Private question', notes: 'Private notes', parcelId: pilot.parcels[0].id, published: pilot.manifest.published, operationId: randomUUID() } });
    assert.equal(created.statusCode, 201);
    const response = await app.inject({ url: '/api/oversight', headers });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.json().cases[0].name, 'Review case');
    assert.ok(!response.body.includes('Private notes'));
    assert.ok(!response.body.includes('Private question'));
    assert.ok(!response.body.includes('coordinates'));
    assert.equal((await app.inject({ url: '/api/oversight', headers: { host: 'external.invalid' } })).statusCode, 403);
  } finally { await app.close(); }
});