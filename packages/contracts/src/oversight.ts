import type { Investigation } from './investigation.ts';
import { evaluateEvidenceReadiness } from './readiness.ts';

export function caseOversight(item: Investigation, today = new Date().toISOString().slice(0, 10)) {
  const parcelIds = (item.snapshot.parcels ?? [item.snapshot.parcel]).map(parcel => parcel.id);
  const readiness = evaluateEvidenceReadiness(item.workflow, item.documents, today, parcelIds);
  const horizon = new Date(`${today}T00:00:00Z`);
  horizon.setUTCDate(horizon.getUTCDate() + 30);
  const through = horizon.toISOString().slice(0, 10);
  const unresolved = readiness.requests.filter(request => request.state !== 'effective');
  const expiring = readiness.requests.filter(request => request.state === 'effective' && request.validUntil >= today && request.validUntil <= through);
  return {
    id: item.id, name: item.name, revision: item.revision, updatedAt: item.updatedAt, parcelIds, evaluatedOn: today,
    state: item.workflow.lifecycle?.state ?? 'active', legalHold: item.workflow.lifecycle?.legalHold ?? false,
    gapCount: readiness.counts.unresolvedGaps, requestCount: readiness.requests.length,
    unresolved, expiring, retention: readiness.retention,
    missingValidityDates: readiness.requests.filter(request => !request.validFrom || !request.validUntil).length,
    needsAttention: readiness.gaps.length > 0 || unresolved.length > 0 || expiring.length > 0,
  };
}

export type CaseOversight = ReturnType<typeof caseOversight>;