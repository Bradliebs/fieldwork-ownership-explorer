import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { emptyWorkflow } from '../packages/contracts/src/consent.ts';
import { evaluateEvidenceReadiness } from '../packages/contracts/src/readiness.ts';
import { grantedWorkflow } from './consent.test.ts';

test('readiness reports factual gaps for an empty workflow', () => {
  const readiness = evaluateEvidenceReadiness(emptyWorkflow(), [], '2026-09-10');
  assert.equal(readiness.retention.state, 'not recorded');
  assert.deepEqual(readiness.gaps.map(gap => gap.code), [
    'project-name-missing', 'requester-missing', 'reply-address-missing', 'retention-review-missing',
    'titles-missing', 'parties-missing', 'requests-missing', 'correspondence-missing',
  ]);
  assert.equal(readiness.counts.unresolvedGaps, 8);
});

test('readiness distinguishes request time and decision states', () => {
  const workflow = grantedWorkflow();
  workflow.retentionReviewOn = '2027-09-10';
  assert.equal(evaluateEvidenceReadiness(workflow, [], '2026-09-09').requests[0].state, 'not yet effective');
  assert.equal(evaluateEvidenceReadiness(workflow, [], '2026-09-10').requests[0].state, 'effective');
  assert.equal(evaluateEvidenceReadiness(workflow, [], '2026-09-21').requests[0].state, 'expired');

  workflow.consents[0].status = 'refused';
  assert.equal(evaluateEvidenceReadiness(workflow, [], '2026-09-10').requests[0].state, 'refused');
  workflow.consents[0].status = 'revoked';
  assert.equal(evaluateEvidenceReadiness(workflow, [], '2026-09-10').requests[0].state, 'revoked');
});

test('readiness identifies retention, correspondence and referenced-document gaps', () => {
  const workflow = grantedWorkflow();
  const documentId = randomUUID();
  workflow.retentionReviewOn = '2026-09-10';
  workflow.consents[0].evidenceRef = `doc:${documentId}`;
  workflow.correspondence.push({
    id: randomUUID(), partyId: workflow.parties[0].id, date: '2026-09-03', method: 'email',
    direction: 'incoming', summary: 'Consent response received.', evidenceRef: '',
  });
  const readiness = evaluateEvidenceReadiness(workflow, [], '2026-09-10');
  assert.equal(readiness.retention.state, 'due');
  assert.ok(readiness.gaps.some(gap => gap.code === 'retention-review-due'));
  assert.ok(readiness.gaps.some(gap => gap.code === 'correspondence-evidence-missing'));
  assert.deepEqual(readiness.referencedDocuments, [{ id: documentId, present: false, referencedBy: 1 }]);
  assert.ok(readiness.gaps.some(gap => gap.code === 'referenced-document-missing' && gap.recordId === documentId));

  const withDocument = evaluateEvidenceReadiness(workflow, [{ id: documentId, name: 'response.txt', mediaType: 'text/plain', size: 8, sha256: 'a'.repeat(64), uploadedAt: '2026-09-10T12:00:00.000Z' }], '2026-09-10');
  assert.equal(withDocument.referencedDocuments[0].present, true);
  assert.ok(!withDocument.gaps.some(gap => gap.code === 'referenced-document-missing'));
});