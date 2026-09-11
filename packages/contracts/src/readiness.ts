import { effectiveConsentStatus, type ConsentWorkflow, type EvidenceDocument } from './consent.ts';

export type ReadinessSection = 'Project' | 'Titles' | 'Parties' | 'Requests' | 'Correspondence' | 'Documents';
export type RequestReadinessState = 'incomplete' | 'awaiting response' | 'not yet effective' | 'effective' | 'expired' | 'refused' | 'revoked';
export type RetentionReadinessState = 'not recorded' | 'upcoming' | 'due';

export interface ReadinessGap {
  section: ReadinessSection;
  recordId?: string;
  code: string;
  message: string;
}

export interface RequestReadiness {
  id: string;
  partyName: string;
  state: RequestReadinessState;
  validFrom: string;
  validUntil: string;
}

export interface ReferencedDocumentReadiness {
  id: string;
  present: boolean;
  referencedBy: number;
}

export interface EvidenceReadiness {
  evaluatedOn: string;
  counts: {
    titles: number;
    checkedTitles: number;
    parties: number;
    approvedContacts: number;
    requests: number;
    correspondence: number;
    documents: number;
    unresolvedGaps: number;
  };
  retention: { reviewOn: string; state: RetentionReadinessState };
  requests: RequestReadiness[];
  referencedDocuments: ReferencedDocumentReadiness[];
  gaps: ReadinessGap[];
  parcelCoverage: { id: string; checkedTitles: number; effectiveGrants: number; unresolvedRequests: number }[];
}

export function evaluateEvidenceReadiness(
  workflow: ConsentWorkflow,
  documents: EvidenceDocument[] = [],
  today = new Date().toISOString().slice(0, 10),
  parcelIds: string[] = [],
): EvidenceReadiness {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error('Readiness date must use YYYY-MM-DD');
  const gaps: ReadinessGap[] = [];
  const addGap = (section: ReadinessSection, code: string, message: string, recordId?: string) => gaps.push({ section, recordId, code, message });

  if (!workflow.project.trim()) addGap('Project', 'project-name-missing', 'Project name is not recorded.');
  if (!workflow.requester.trim()) addGap('Project', 'requester-missing', 'Requesting company and contact are not recorded.');
  if (!workflow.replyAddress.trim()) addGap('Project', 'reply-address-missing', 'Reply address or email is not recorded.');
  const retentionState: RetentionReadinessState = !workflow.retentionReviewOn ? 'not recorded' : workflow.retentionReviewOn <= today ? 'due' : 'upcoming';
  if (retentionState === 'not recorded') addGap('Project', 'retention-review-missing', 'Retention review date is not recorded.');
  if (retentionState === 'due') addGap('Project', 'retention-review-due', `Retention review was due on ${workflow.retentionReviewOn}.`);

  for (const title of workflow.titles) {
    if (parcelIds.length > 1 && !title.parcelIds?.length) addGap('Titles', 'title-parcels-missing', 'Title parcel scope is not recorded.', title.id);
    if (!title.titleNumber) addGap('Titles', 'title-number-missing', 'Title number is not recorded.', title.id);
    if (!title.evidenceRef.trim()) addGap('Titles', 'title-evidence-missing', 'Title evidence reference is not recorded.', title.id);
    if (!title.evidenceDate) addGap('Titles', 'title-evidence-date-missing', 'Title evidence date is not recorded.', title.id);
    if (title.relationship === 'unconfirmed') addGap('Titles', 'title-relationship-unconfirmed', 'Parcel relationship is unconfirmed.', title.id);
    if (!title.extentNotes.trim()) addGap('Titles', 'title-extent-missing', 'Extent assessment and plan reference are not recorded.', title.id);
    if (title.verification !== 'checked') addGap('Titles', 'title-unchecked', 'Title assessment is not checked.', title.id);
    if (!title.reviewedBy.trim()) addGap('Titles', 'title-reviewer-missing', 'Title reviewer is not recorded.', title.id);
    if (!title.reviewedOn) addGap('Titles', 'title-review-date-missing', 'Title review date is not recorded.', title.id);
  }
  if (!workflow.titles.length) addGap('Titles', 'titles-missing', 'No title evidence is recorded.');

  for (const party of workflow.parties) {
    if (!party.name.trim()) addGap('Parties', 'party-name-missing', 'Party name is not recorded.', party.id);
    if (!party.titleId) addGap('Parties', 'party-title-missing', 'Party is not linked to a title.', party.id);
    if (!(party.email.trim() || party.postalAddress.trim() || party.phone.trim())) addGap('Parties', 'contact-route-missing', 'No contact route is recorded.', party.id);
    if (!party.contactSource.trim()) addGap('Parties', 'contact-source-missing', 'Contact source and permitted-use assessment are not recorded.', party.id);
    if (!party.contactCheckedOn) addGap('Parties', 'contact-check-date-missing', 'Contact check date is not recorded.', party.id);
    if (party.contactUse !== 'approved') addGap('Parties', 'contact-use-unconfirmed', 'Commercial contact use is unconfirmed.', party.id);
    if (!party.authorityEvidence.trim()) addGap('Parties', 'authority-evidence-missing', 'Authority evidence reference is not recorded.', party.id);
    if (!party.authorityCheckedBy.trim()) addGap('Parties', 'authority-reviewer-missing', 'Authority reviewer is not recorded.', party.id);
    if (!party.authorityCheckedOn) addGap('Parties', 'authority-review-date-missing', 'Authority review date is not recorded.', party.id);
  }
  if (!workflow.parties.length) addGap('Parties', 'parties-missing', 'No relevant parties are recorded.');

  const requests = workflow.consents.map(permission => {
    if (parcelIds.length > 1 && !permission.parcelIds?.length) addGap('Requests', 'request-parcels-missing', 'Request parcel scope is not recorded.', permission.id);
    const partyName = workflow.parties.find(party => party.id === permission.partyId)?.name || 'Missing party';
    const effective = effectiveConsentStatus(permission, today);
    let state: RequestReadinessState;
    if (effective === 'granted') state = 'effective';
    else if (effective === 'not requested') state = 'incomplete';
    else state = effective as RequestReadinessState;
    if (!permission.activities.trim()) addGap('Requests', 'request-activities-missing', 'Proposed activities are not recorded.', permission.id);
    if (!permission.landScope.trim()) addGap('Requests', 'request-scope-missing', 'Exact land scope and plan reference are not recorded.', permission.id);
    if (permission.status === 'not requested') addGap('Requests', 'request-not-sent', 'Consent request is not recorded as sent.', permission.id);
    if (permission.status === 'awaiting response' && !permission.requestedOn) addGap('Requests', 'request-date-missing', 'Request sent date is not recorded.', permission.id);
    if (['granted', 'refused', 'revoked'].includes(permission.status) && !permission.responseOn) addGap('Requests', 'response-date-missing', 'Response date is not recorded.', permission.id);
    if (['granted', 'refused', 'revoked'].includes(permission.status) && !permission.evidenceRef.trim()) addGap('Requests', 'decision-evidence-missing', 'Decision evidence reference is not recorded.', permission.id);
    if (permission.status === 'granted') {
      if (!permission.validFrom) addGap('Requests', 'valid-from-missing', 'Consent valid-from date is not recorded.', permission.id);
      if (!permission.validUntil) addGap('Requests', 'valid-until-missing', 'Consent valid-until date is not recorded.', permission.id);
      if (!permission.signatory.trim()) addGap('Requests', 'signatory-missing', 'Signatory name and capacity are not recorded.', permission.id);
    }
    return { id: permission.id, partyName, state, validFrom: permission.validFrom, validUntil: permission.validUntil };
  });
  if (!workflow.consents.length) addGap('Requests', 'requests-missing', 'No consent requests are recorded.');
  if (parcelIds.length > 1) {
    for (const parcelId of parcelIds) {
      if (!workflow.titles.some(title => title.verification === 'checked' && title.parcelIds?.includes(parcelId))) addGap('Titles', 'parcel-title-missing', `${parcelId}: no checked title assessment is scoped to this parcel.`);
      if (!workflow.consents.some(permission => permission.parcelIds?.includes(parcelId))) addGap('Requests', 'parcel-request-missing', `${parcelId}: no consent request is scoped to this parcel.`);
    }
  }

  for (const entry of workflow.correspondence) {
    if (!entry.date) addGap('Correspondence', 'correspondence-date-missing', 'Correspondence date is not recorded.', entry.id);
    if (!entry.summary.trim()) addGap('Correspondence', 'correspondence-summary-missing', 'Correspondence summary is not recorded.', entry.id);
    if (!entry.evidenceRef.trim()) addGap('Correspondence', 'correspondence-evidence-missing', 'Correspondence evidence reference is not recorded.', entry.id);
  }
  if (!workflow.correspondence.length) addGap('Correspondence', 'correspondence-missing', 'No correspondence is recorded.');

  const references = [
    ...workflow.titles.map(record => ({ recordId: record.id, reference: record.evidenceRef })),
    ...workflow.parties.map(record => ({ recordId: record.id, reference: record.authorityEvidence })),
    ...workflow.consents.map(record => ({ recordId: record.id, reference: record.evidenceRef })),
    ...workflow.correspondence.map(record => ({ recordId: record.id, reference: record.evidenceRef })),
  ].filter(item => item.reference.startsWith('doc:'));
  const referencedDocuments = [...new Set(references.map(item => item.reference.slice(4)))].map(id => {
    const present = documents.some(document => document.id === id);
    const referencedBy = references.filter(item => item.reference === `doc:${id}`).length;
    if (!present) addGap('Documents', 'referenced-document-missing', `Referenced document doc:${id} is not attached.`, id);
    return { id, present, referencedBy };
  });

  return {
    evaluatedOn: today,
    parcelCoverage: parcelIds.map(id => {
      const scoped = workflow.consents.filter(permission => (permission.parcelIds ?? (parcelIds.length === 1 ? parcelIds : [])).includes(id));
      return { id, checkedTitles: workflow.titles.filter(title => title.verification === 'checked' && (title.parcelIds ?? (parcelIds.length === 1 ? parcelIds : [])).includes(id)).length,
        effectiveGrants: scoped.filter(permission => effectiveConsentStatus(permission, today) === 'granted').length,
        unresolvedRequests: scoped.filter(permission => effectiveConsentStatus(permission, today) !== 'granted').length };
    }),
    counts: {
      titles: workflow.titles.length,
      checkedTitles: workflow.titles.filter(title => title.verification === 'checked').length,
      parties: workflow.parties.length,
      approvedContacts: workflow.parties.filter(party => party.contactUse === 'approved').length,
      requests: workflow.consents.length,
      correspondence: workflow.correspondence.length,
      documents: documents.length,
      unresolvedGaps: gaps.length,
    },
    retention: { reviewOn: workflow.retentionReviewOn, state: retentionState },
    requests,
    referencedDocuments,
    gaps,
  };
}