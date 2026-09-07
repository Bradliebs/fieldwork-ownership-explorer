import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateLink, reviewLink, parcelStatus, type OwnershipLink } from '../packages/contracts/src/ownership.ts';

const candidate: OwnershipLink = {
  id: 'link-1', titleNumber: 'DEMO001', proprietors: ['Example Estates', 'Example Trust'],
  interest: 'freehold', status: 'candidate', review: 'pending',
  evidence: [{ id: 'evidence-1', source: 'Synthetic fixture', sourceDate: '2026-09-06',
    reference: 'fixture:1', method: 'address', scope: 'whole', interest: 'freehold', establishesRelationship: false }],
};

test('review preserves inferred status and all proprietors', () => {
  const reviewed = reviewLink(candidate, 'reviewed');
  assert.equal(reviewed.status, 'candidate');
  assert.deepEqual(reviewed.proprietors, candidate.proprietors);
  assert.equal(candidate.review, 'pending');
});

for (const method of ['address', 'overlap'] as const) {
  test(`${method} evidence cannot verify ownership even if asserted as establishing it`, () => {
    assert.throws(() => validateLink({ ...candidate, status: 'verified', evidence: [
      { ...candidate.evidence[0]!, method, establishesRelationship: true },
    ] }));
  });
}

test('documentary verification must match both scope and interest', () => {
  const evidence = { ...candidate.evidence[0]!, method: 'documentary' as const, establishesRelationship: true };
  assert.doesNotThrow(() => validateLink({ ...candidate, status: 'verified', evidence: [evidence] }));
  assert.throws(() => validateLink({ ...candidate, status: 'verified', evidence: [{ ...evidence, scope: 'partial' }] }));
  assert.throws(() => validateLink({ ...candidate, status: 'verified', evidence: [{ ...evidence, interest: 'leasehold' }] }));
});

test('absent or rejected links are unknown, not private ownership', () => {
  const parcel = { id: 'demo', label: 'Example', geometry: { type: 'Polygon' as const, coordinates: [] }, revision: 0, links: [] };
  assert.equal(parcelStatus(parcel), 'unknown');
  assert.equal(parcelStatus({ ...parcel, links: [{ ...candidate, review: 'rejected' }] }), 'unknown');
});