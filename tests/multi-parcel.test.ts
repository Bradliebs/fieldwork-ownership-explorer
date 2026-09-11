import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { emptyWorkflow, validateParcelScope, type ConsentWorkflow } from '../packages/contracts/src/consent.ts';
import { buildServer } from '../apps/server/src/server.ts';
import { readFileSync } from 'node:fs';
import { evaluateEvidenceReadiness } from '../packages/contracts/src/readiness.ts';
import { consentRequest } from '../apps/server/src/consent-report.ts';
import { salesForParcels } from '../packages/contracts/src/sales.ts';

test('multi-parcel permissions require explicit in-case scope within the assessed title', () => {
  const titleId = randomUUID();
  const partyId = randomUUID();
  const workflow: ConsentWorkflow = { ...emptyWorkflow(),
    titles: [{ id: titleId, titleNumber: 'AV1', tenure: 'freehold', evidenceRef: 'Register', evidenceDate: '2026-09-01', relationship: 'part', extentNotes: 'Plan A', verification: 'checked', reviewedBy: 'Reviewer', reviewedOn: '2026-09-01' }],
    parties: [{ id: partyId, titleId, name: 'Fictional party', capacity: 'registered proprietor', postalAddress: '', email: '', phone: '', contactSource: '', contactCheckedOn: '', contactUse: 'unconfirmed', authorityEvidence: 'Authority', authorityCheckedBy: 'Reviewer', authorityCheckedOn: '2026-09-01' }],
    consents: [{ id: randomUUID(), partyId, activities: 'Survey', landScope: 'Plan A', status: 'granted', requestedOn: '2026-09-01', responseOn: '2026-09-02', validFrom: '2026-09-03', validUntil: '2026-09-30', conditions: '', signatory: 'Fictional signer', evidenceRef: 'Signed reply' }],
  };
  assert.doesNotThrow(() => validateParcelScope(workflow, ['INSPIRE-1']));
  assert.throws(() => validateParcelScope(workflow, ['INSPIRE-1', 'INSPIRE-2']), /checked title/);
  workflow.titles[0].parcelIds = ['INSPIRE-1'];
  assert.throws(() => validateParcelScope(workflow, ['INSPIRE-1', 'INSPIRE-2']), /sent request or decision/);
  workflow.consents[0].parcelIds = ['INSPIRE-2'];
  assert.throws(() => validateParcelScope(workflow, ['INSPIRE-1', 'INSPIRE-2']), /exceeds/);
  workflow.consents[0].parcelIds = ['INSPIRE-1'];
  assert.doesNotThrow(() => validateParcelScope(workflow, ['INSPIRE-1', 'INSPIRE-2']));
  const readiness = evaluateEvidenceReadiness(workflow, [], '2026-09-11', ['INSPIRE-1', 'INSPIRE-2']);
  assert.deepEqual(readiness.parcelCoverage, [
    { id: 'INSPIRE-1', checkedTitles: 1, effectiveGrants: 1, unresolvedRequests: 0 },
    { id: 'INSPIRE-2', checkedTitles: 0, effectiveGrants: 0, unresolvedRequests: 0 },
  ]);
  assert.ok(readiness.gaps.some(gap => gap.code === 'parcel-title-missing' && gap.message.includes('INSPIRE-2')));
  assert.ok(readiness.gaps.some(gap => gap.code === 'parcel-request-missing' && gap.message.includes('INSPIRE-2')));
  workflow.consents[0].parcelIds = ['INSPIRE-3'];
  assert.throws(() => validateParcelScope(workflow, ['INSPIRE-1', 'INSPIRE-2']), /missing/);
});

test('multi-parcel API captures authoritative geometry, preserves it on edits and rejects invalid inclusion', async () => {
  const app = buildServer({ port: 4317 });
  const headers = { host: '127.0.0.1:4317' };
  const pilot = JSON.parse(readFileSync(new URL('../public/pilot/parcels.json', import.meta.url), 'utf8'));
  try {
    const { token } = (await app.inject({ url: '/api/session', headers })).json();
    const authenticated = { ...headers, 'x-local-token': token };
    const parcelIds = pilot.parcels.slice(0, 2).map((parcel: { id: string }) => parcel.id);
    const payload = { name: 'Two-parcel site', question: '', notes: '', parcelId: parcelIds[0], parcelIds, published: pilot.manifest.published, operationId: randomUUID() };
    const created = await app.inject({ method: 'POST', url: '/api/investigations', headers: authenticated, payload });
    assert.equal(created.statusCode, 201, created.body);
    const saved = created.json().investigation;
    assert.deepEqual(saved.snapshot.parcels, pilot.parcels.slice(0, 2));
    const updated = await app.inject({ method: 'PUT', url: `/api/investigations/${saved.id}`, headers: authenticated, payload: { name: payload.name, question: '', notes: 'Site notes', revision: 0 } });
    assert.equal(updated.statusCode, 200);
    assert.deepEqual(updated.json().investigation.snapshot, saved.snapshot);
    const report = await app.inject({ url: `/api/investigations/${saved.id}/report`, headers });
    assert.equal(report.statusCode, 200);
    assert.equal((report.body.match(/<path /g) ?? []).length, 2);
    for (const id of parcelIds) assert.ok(report.body.includes(id));
    const recoveryId = randomUUID();
    const checkpoint = { sequence: 1, operationId: randomUUID(), investigationId: null, baseRevision: null, parcelId: parcelIds[0], parcelIds, published: pilot.manifest.published, edit: { name: '', question: '', notes: 'Site draft' } };
    const draft = await app.inject({ method: 'PUT', url: `/api/recovery-drafts/${recoveryId}`, headers: authenticated, payload: checkpoint });
    assert.equal(draft.statusCode, 200, draft.body);
    assert.deepEqual(draft.json().draft.snapshot.parcels, saved.snapshot.parcels);
    assert.equal((await app.inject({ method: 'PUT', url: `/api/recovery-drafts/${recoveryId}`, headers: authenticated, payload: { ...checkpoint, sequence: 2, parcelIds: [parcelIds[0]] } })).statusCode, 409);
    const partyId = randomUUID();
    const permissionId = randomUUID();
    const requestCase = { ...saved, workflow: { ...emptyWorkflow(), project: 'Site survey', requester: 'Fictional team', replyAddress: 'office@example.test',
      parties: [{ id: partyId, name: 'Fictional recipient', email: 'contact@example.test', postalAddress: '', contactUse: 'approved' }],
      consents: [{ id: permissionId, partyId, activities: 'Survey', landScope: 'Plan A', validFrom: '2026-09-12', validUntil: '2026-09-30', conditions: '', parcelIds: [parcelIds[1]] }],
    } };
    const request = consentRequest(requestCase, permissionId, 'nonce');
    assert.ok(request.includes(parcelIds[1]));
    assert.ok(!request.includes(parcelIds[0]));
    requestCase.workflow.consents[0].parcelIds = [];
    assert.throws(() => consentRequest(requestCase, permissionId, 'nonce'), /explicit parcel scope/);
    for (const ids of [[parcelIds[0], parcelIds[0]], [parcelIds[0], 'INSPIRE-0'], [parcelIds[1]]]) {
      assert.equal((await app.inject({ method: 'POST', url: '/api/investigations', headers: authenticated, payload: { ...payload, operationId: randomUUID(), parcelIds: ids } })).statusCode, 400);
    }
  } finally { await app.close(); }
});

test('a transaction associated with several site parcels is captured only once', () => {
  const release = JSON.parse(readFileSync(new URL('../public/pilot/sales.json', import.meta.url), 'utf8'));
  release.records[0].inspireIds = ['1', '2'];
  const selected = salesForParcels(release, ['1', '2'])!;
  assert.equal(selected.records.filter(record => record.transactionId === release.records[0].transactionId).length, 1);
});