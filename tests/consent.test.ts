import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createInvestigationStore } from '../apps/server/src/investigation-store.ts';
import { investigationSchemaVersion } from '../apps/server/src/investigation-migrations.ts';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildServer } from '../apps/server/src/server.ts';
import { emptyWorkflow, workflowSchema, effectiveConsentStatus, validateDocumentReferences, type ConsentWorkflow } from '../packages/contracts/src/consent.ts';

export function grantedWorkflow(): ConsentWorkflow {
  const titleId = randomUUID(); const partyId = randomUUID();
  return { ...emptyWorkflow(), project: 'Access survey', requester: 'Example Construction', replyAddress: 'Project office',
    titles: [{ id: titleId, titleNumber: 'AV12345', tenure: 'freehold', evidenceRef: 'Register and plan reference 1', evidenceDate: '2026-09-01', relationship: 'part', extentNotes: 'Red hatched access strip on plan A', verification: 'checked', reviewedBy: 'Reviewer', reviewedOn: '2026-09-02' }],
    parties: [{ id: partyId, titleId, name: 'Example Estates Ltd', capacity: 'registered proprietor', postalAddress: 'Office address', email: '', phone: '', contactSource: 'Current title register', contactCheckedOn: '2026-09-02', contactUse: 'approved', authorityEvidence: 'Signed authority reference 2', authorityCheckedBy: 'Reviewer', authorityCheckedOn: '2026-09-03' }],
    consents: [{ id: randomUUID(), partyId, activities: 'Walkover survey only', landScope: 'Access strip on plan A', status: 'granted', requestedOn: '2026-09-02', responseOn: '2026-09-03', validFrom: '2026-09-10', validUntil: '2026-09-20', conditions: 'Daylight only', signatory: 'Authorised signatory', evidenceRef: 'Signed licence reference 3' }], correspondence: [],
  };
}
test('consent checks enforce evidence, party authority, dates and scope', () => {
  const workflow = grantedWorkflow();
  assert.ok(workflowSchema.safeParse(workflow).success);
  for (const mutate of [
    (value: ConsentWorkflow) => { value.parties[0].authorityEvidence = ''; },
    (value: ConsentWorkflow) => { value.titles[0].verification = 'unverified'; },
    (value: ConsentWorkflow) => { value.consents[0].landScope = ''; },
    (value: ConsentWorkflow) => { value.consents[0].evidenceRef = ''; },
    (value: ConsentWorkflow) => { value.consents[0].validUntil = '2026-09-01'; },
    (value: ConsentWorkflow) => { value.consents[0].responseOn = '2026-02-30'; },
    (value: ConsentWorkflow) => { value.parties = []; },
  ]) { const changed = structuredClone(workflow); mutate(changed); assert.equal(workflowSchema.safeParse(changed).success, false); }
  assert.equal(effectiveConsentStatus(workflow.consents[0], '2026-09-07'), 'not yet effective');
  assert.equal(effectiveConsentStatus(workflow.consents[0], '2026-09-15'), 'granted');
  assert.equal(effectiveConsentStatus(workflow.consents[0], '2026-09-21'), 'expired');
  workflow.consents[0].evidenceRef = `doc:${randomUUID()}`;
  assert.throws(() => validateDocumentReferences(workflow, []), /missing/);
});
test('contact use must be approved before an outgoing request is recorded', () => {
  const workflow = grantedWorkflow(); workflow.consents[0].status = 'awaiting response'; workflow.parties[0].contactUse = 'unconfirmed';
  assert.equal(workflowSchema.safeParse(workflow).success, false);
  assert.ok(workflowSchema.safeParse(emptyWorkflow()).success);
});

test('workflow edits and private attachments persist with revision control', () => {
  const store = createInvestigationStore();
  try {
    const pilot = JSON.parse(readFileSync(new URL('../public/pilot/parcels.json', import.meta.url), 'utf8'));
    const item = store.create({ name: 'Consent case', question: '', notes: '', workflow: grantedWorkflow() }, { dataset: 'pilot', releaseSha256: 'test', parcel: pilot.parcels[0], manifest: pilot.manifest });
    const uploaded = store.addDocument(item.id, 0, 'permission.txt', 'text/plain', Buffer.from('Signed permission fixture'));
    assert.equal(uploaded.revision, 1);
    assert.equal(store.document(item.id, uploaded.documents[0].id)!.content.toString(), 'Signed permission fixture');
    assert.equal(store.document(randomUUID(), uploaded.documents[0].id), undefined);
    assert.throws(() => store.addDocument(item.id, 0, 'stale.txt', 'text/plain', Buffer.from('stale')), /Revision conflict/);
    assert.throws(() => store.addDocument(item.id, 1, 'bad.pdf', 'application/pdf', Buffer.from('not a PDF')), /Only PDF/);
    assert.equal(store.get(item.id)!.documents.length, 1);
    const workflow = grantedWorkflow(); workflow.consents[0].evidenceRef = `doc:${uploaded.documents[0].id}`;
    store.update(item.id, 1, { name: item.name, question: '', notes: '', workflow });
    assert.deepEqual(store.get(item.id)!.workflow, workflow);
    assert.equal(store.history(item.id).length, 3);
    store.update(item.id, 2, { name: item.name, question: '', notes: 'Legacy edit without workflow' });
    assert.deepEqual(store.get(item.id)!.workflow, workflow);
  } finally { store.close(); }
});

test('v1 cases migrate without loss and the pre-upgrade backup remains restorable', () => {
  const directory = mkdtempSync(join(tmpdir(), 'consent-migration-'));
  const path = join(directory, 'cases.sqlite');
  const database = new DatabaseSync(path);
  const pilot = JSON.parse(readFileSync(new URL('../public/pilot/parcels.json', import.meta.url), 'utf8'));
  const snapshot = { dataset: 'pilot', releaseSha256: 'old', parcel: pilot.parcels[0], manifest: pilot.manifest };
  const caseId = randomUUID();
  database.exec(`CREATE TABLE investigations (id TEXT PRIMARY KEY, name TEXT NOT NULL, question TEXT NOT NULL, notes TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision >= 0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, snapshot TEXT NOT NULL);
    CREATE TABLE investigation_events (investigation_id TEXT NOT NULL REFERENCES investigations(id), revision INTEGER NOT NULL, action TEXT NOT NULL, at TEXT NOT NULL, name TEXT NOT NULL, question TEXT NOT NULL, notes TEXT NOT NULL, PRIMARY KEY(investigation_id, revision));
    PRAGMA user_version=1;`);
  database.prepare('INSERT INTO investigations VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(caseId, 'Original case', 'Original question', 'Do not lose notes', 0, '2026-09-01', '2026-09-01', JSON.stringify(snapshot));
  database.prepare('INSERT INTO investigation_events VALUES (?, 0, ?, ?, ?, ?, ?)').run(caseId, 'created', '2026-09-01', 'Original case', 'Original question', 'Do not lose notes');
  database.close();
  let store = createInvestigationStore(path);
  try {
    assert.equal(store.get(caseId)!.notes, 'Do not lose notes');
    assert.deepEqual(store.get(caseId)!.snapshot, snapshot);
    assert.deepEqual(store.get(caseId)!.workflow, emptyWorkflow());
    assert.equal(store.history(caseId).length, 1);
    const backups = readdirSync(directory).filter(name => name.startsWith(`cases.sqlite.pre-v1-to-v${investigationSchemaVersion}.`) && name.endsWith('.bak'));
    assert.equal(backups.length, 1);
    const item = store.addDocument(caseId, 0, 'authority.txt', 'text/plain', Buffer.from('Evidence fixture'));
    const workflow = grantedWorkflow(); workflow.consents[0].evidenceRef = `doc:${item.documents[0].id}`;
    store.update(caseId, 1, { name: item.name, question: item.question, notes: item.notes, workflow });
    store.close(); store = createInvestigationStore(path);
    assert.deepEqual(store.get(caseId)!.workflow, workflow);
    assert.equal(store.document(caseId, item.documents[0].id)!.content.toString(), 'Evidence fixture');
    const restored = createInvestigationStore(join(directory, backups[0]));
    try { assert.equal(restored.get(caseId)!.notes, 'Do not lose notes'); assert.deepEqual(restored.get(caseId)!.workflow, emptyWorkflow()); } finally { restored.close(); }
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('API protects attachments, rejects unsupported grants and produces unsent drafts', async () => {
  const app = buildServer({ port: 4317 });
  const headers = { host: '127.0.0.1:4317' };
  const pilot = JSON.parse(readFileSync(new URL('../public/pilot/parcels.json', import.meta.url), 'utf8'));
  try {
    const session = (await app.inject({ url: '/api/session', headers })).json();
    const authorised = { ...headers, 'x-local-token': session.token };
    const workflow = grantedWorkflow(); workflow.parties[0].name = '<script>bad()</script> Estates';
    const body = { name: 'Consent API case', question: '', notes: '', workflow, parcelId: pilot.parcels[0].id, published: pilot.manifest.published, operationId: randomUUID() };
    const invalid = structuredClone(body); invalid.workflow.parties[0].authorityEvidence = '';
    assert.equal((await app.inject({ method: 'POST', url: '/api/investigations', headers: authorised, payload: invalid })).statusCode, 400);
    const created = await app.inject({ method: 'POST', url: '/api/investigations', headers: authorised, payload: body });
    assert.equal(created.statusCode, 201);
    const item = created.json().investigation;
    const documentPath = `/api/investigations/${item.id}/documents`;
    const payload = { revision: 0, name: 'signed.txt', mediaType: 'text/plain', base64: Buffer.from('Signature fixture').toString('base64') };
    assert.equal((await app.inject({ method: 'POST', url: documentPath, headers, payload })).statusCode, 403);
    const attached = await app.inject({ method: 'POST', url: documentPath, headers: authorised, payload });
    assert.equal(attached.statusCode, 200);
    const document = attached.json().investigation.documents[0];
    assert.equal((await app.inject({ method: 'POST', url: documentPath, headers: authorised, payload })).statusCode, 409);
    const download = await app.inject({ url: `${documentPath}/${document.id}`, headers });
    assert.equal(download.body, 'Signature fixture');
    assert.match(String(download.headers['content-disposition']), /attachment/);
    assert.equal(download.headers['cache-control'], 'no-store');
    assert.equal((await app.inject({ url: `${documentPath}/${document.id}`, headers: { host: 'evil.example' } })).statusCode, 403);
    assert.equal((await app.inject({ url: `/api/investigations/${randomUUID()}/documents/${document.id}`, headers })).statusCode, 404);
    const request = await app.inject({ url: `/api/investigations/${item.id}/requests/${workflow.consents[0].id}`, headers });
    assert.equal(request.statusCode, 200);
    assert.match(request.body, /DRAFT \/ NOT SENT/);
    assert.match(request.body, /&lt;script&gt;bad/);
    assert.doesNotMatch(request.body, /<script>bad/);
    const saved = (await app.inject({ url: `/api/investigations/${item.id}`, headers })).json().investigation;
    assert.equal(saved.revision, 1);
    assert.equal(saved.workflow.consents[0].status, 'granted');
    assert.deepEqual(saved.snapshot.parcel.links, []);
    const report = await app.inject({ url: `/api/investigations/${item.id}/report`, headers });
    assert.match(report.body, /Landowner contact and consent register/);
    assert.match(report.body, /Evidence readiness/);
    assert.match(report.body, /Request states/);
    assert.match(report.body, /factual record gaps identified/);
    assert.match(report.body, /This is not a legal or works approval/);
    assert.match(report.body, /Not supplied by INSPIRE; see case title assessments/);
    assert.doesNotMatch(report.body, /No ownership evidence loaded/);
    assert.ok(report.body.includes(document.sha256));
  } finally { await app.close(); }
});