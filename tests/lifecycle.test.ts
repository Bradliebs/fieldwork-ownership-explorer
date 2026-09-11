import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createInvestigationStore } from '../apps/server/src/investigation-store.ts';
import { emptyWorkflow, workflowSchema } from '../packages/contracts/src/consent.ts';
import { consentReport } from '../apps/server/src/consent-report.ts';

test('lifecycle archive and hold decisions preserve history, reject ordinary writes and require explicit release', () => {
  const pilot = JSON.parse(readFileSync(new URL('../public/pilot/parcels.json', import.meta.url), 'utf8'));
  const store = createInvestigationStore();
  try {
    const original = store.create({ name: 'Retention case', question: '', notes: 'Retained notes' }, { dataset: 'pilot', parcel: pilot.parcels[0], manifest: pilot.manifest, releaseSha256: 'source' });
    const lifecycle = { state: 'archived' as const, legalHold: true, holdReason: 'Pending dispute', releaseReason: '', reviewedBy: 'Records reviewer', reviewedOn: '2026-09-11', decisionReason: 'Preserve case pending review' };
    const archived = store.update(original.id, 0, { ...original, workflow: { ...original.workflow, lifecycle } });
    assert.equal(archived.workflow.lifecycle!.legalHold, true);
    assert.match(consentReport(archived), /Records lifecycle/);
    assert.match(consentReport(archived), /Pending dispute/);
    assert.match(consentReport(archived), /Legal hold:<\/strong> Active/);
    assert.throws(() => store.update(original.id, 1, { ...archived, notes: 'Changed' }), /read-only/);
    assert.throws(() => store.addDocument(original.id, 1, 'new.txt', 'text/plain', Buffer.from('new')), /cannot accept/);
    assert.throws(() => store.update(original.id, 1, { ...archived, workflow: emptyWorkflow() }), /cannot be removed/);
    assert.throws(() => store.update(original.id, 1, { ...archived, workflow: { ...archived.workflow, lifecycle: { ...lifecycle, legalHold: false } } }), /release reason/);
    assert.throws(() => store.update(original.id, 1, { ...archived, workflow: { ...archived.workflow, lifecycle: { ...lifecycle, reviewedOn: '2026-09-10' } } }), /precede/);
    assert.equal(store.get(original.id)!.revision, 1);
    const reopened = store.update(original.id, 1, { ...archived, workflow: { ...archived.workflow, lifecycle: { ...lifecycle, state: 'active', legalHold: false, releaseReason: 'Dispute concluded', decisionReason: 'Resume records work' } } });
    const edited = store.update(original.id, 2, { ...reopened, notes: 'New notes' });
    assert.equal(edited.revision, 3);
    assert.equal(store.revision(original.id, 1)!.workflow.lifecycle!.holdReason, 'Pending dispute');
    assert.equal(store.revision(original.id, 0)!.workflow.lifecycle, undefined);
    assert.throws(() => workflowSchema.parse({ ...emptyWorkflow(), lifecycle: { ...lifecycle, reviewedBy: '' } }), /reviewer/);
    assert.throws(() => workflowSchema.parse({ ...emptyWorkflow(), lifecycle: { ...lifecycle, holdReason: '' } }), /reason/);
    assert.throws(() => workflowSchema.parse({ ...emptyWorkflow(), lifecycle: { ...lifecycle, releaseReason: 'Old release' } }), /active legal hold/);
  } finally { store.close(); }
});