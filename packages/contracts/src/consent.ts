import { z } from 'zod';

const text = z.string().max(2000);
const short = z.string().max(200);
const date = z.string().refine(value => value === '' || (/^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value), 'Use a valid calendar date');
const id = z.string().uuid();
const titleSchema = z.object({
  id, titleNumber: z.string().regex(/^[A-Z]{0,3}[0-9]{1,9}$/, 'Enter a title number, not an INSPIRE ID'),
  tenure: z.enum(['freehold', 'leasehold', 'other']), evidenceRef: text, evidenceDate: date,
  relationship: z.enum(['unconfirmed', 'whole', 'part', 'related']), extentNotes: text,
  verification: z.enum(['unverified', 'checked']), reviewedBy: short, reviewedOn: date,
}).strict();
const partySchema = z.object({
  id, name: short.refine(value => Boolean(value.trim()), 'Party name is required'),
  capacity: z.enum(['registered proprietor', 'leaseholder', 'occupier', 'agent', 'other']), titleId: z.union([id, z.literal('')]),
  postalAddress: text, email: z.union([z.literal(''), z.string().email().max(254)]), phone: z.string().max(80),
  contactSource: text, contactCheckedOn: date, contactUse: z.enum(['unconfirmed', 'approved']),
  authorityEvidence: text, authorityCheckedBy: short, authorityCheckedOn: date,
}).strict();
const permissionSchema = z.object({
  id, partyId: id, activities: text, landScope: text,
  status: z.enum(['not requested', 'awaiting response', 'granted', 'refused', 'revoked']),
  requestedOn: date, responseOn: date, validFrom: date, validUntil: date,
  conditions: text, signatory: short, evidenceRef: text,
}).strict();
const correspondenceSchema = z.object({
  id, partyId: id, date: date.refine(Boolean, 'Correspondence date is required'),
  method: z.enum(['email', 'letter', 'phone', 'meeting', 'other']), direction: z.enum(['incoming', 'outgoing']),
  summary: text.refine(value => Boolean(value.trim()), 'Correspondence summary is required'), evidenceRef: text,
}).strict();

export const workflowSchema = z.object({
  project: short, requester: short, replyAddress: text, retentionReviewOn: date,
  titles: z.array(titleSchema).max(30), parties: z.array(partySchema).max(50),
  consents: z.array(permissionSchema).max(100), correspondence: z.array(correspondenceSchema).max(200),
}).strict().superRefine((workflow, context) => {
  const fail = (message: string) => context.addIssue({ code: 'custom', message });
  const allIds = [...workflow.titles, ...workflow.parties, ...workflow.consents, ...workflow.correspondence].map(record => record.id);
  if (new Set(allIds).size !== allIds.length) fail('Record identifiers must be unique');
  for (const title of workflow.titles) {
    if (title.verification === 'checked' && (!title.evidenceRef.trim() || !title.evidenceDate || !title.reviewedBy.trim() || !title.reviewedOn || title.relationship === 'unconfirmed' || !title.extentNotes.trim())) fail('Checked titles need source evidence, dates, reviewer and extent assessment');
  }
  for (const party of workflow.parties) {
    if (party.titleId && !workflow.titles.some(title => title.id === party.titleId)) fail('Party references a missing title');
    if (party.contactUse === 'approved' && (!party.contactSource.trim() || !party.contactCheckedOn || !(party.email.trim() || party.postalAddress.trim() || party.phone.trim()))) fail('Approved contact use needs a contact route, source and check date');
  }
  for (const permission of workflow.consents) {
    const party = workflow.parties.find(candidate => candidate.id === permission.partyId);
    if (!party) { fail('Consent references a missing party'); continue; }
    if (permission.validFrom && permission.validUntil && permission.validUntil < permission.validFrom) fail('Consent end date precedes its start date');
    if (permission.requestedOn && permission.responseOn && permission.responseOn < permission.requestedOn) fail('Response date precedes the request');
    if (permission.status !== 'not requested' && (!permission.activities.trim() || !permission.landScope.trim())) fail('Consent needs activities and an exact land scope');
    if (permission.status === 'awaiting response' && (!permission.requestedOn || party.contactUse !== 'approved')) fail('Awaiting response requires a request date and approved contact use');
    if (['granted', 'refused', 'revoked'].includes(permission.status) && (!permission.responseOn || !permission.evidenceRef.trim())) fail('Decisions need a response date and evidence reference');
    if (permission.status === 'granted') {
      const title = workflow.titles.find(candidate => candidate.id === party.titleId);
      if (!title || title.verification !== 'checked' || !['whole', 'part'].includes(title.relationship)) fail('Granted consent requires a checked title covering the relevant land');
      if (!permission.signatory.trim() || !permission.validFrom || !permission.validUntil || !party.authorityEvidence.trim() || !party.authorityCheckedBy.trim() || !party.authorityCheckedOn) fail('Granted consent requires signatory, validity dates and a documented authority check');
    }
  }
  for (const entry of workflow.correspondence) {
    const party = workflow.parties.find(candidate => candidate.id === entry.partyId);
    if (!party) fail('Correspondence references a missing party');
    if (entry.direction === 'outgoing' && party?.contactUse !== 'approved') fail('Outgoing correspondence requires approved contact use');
  }
});

export type ConsentWorkflow = z.infer<typeof workflowSchema>;
export type TitleRecord = ConsentWorkflow['titles'][number];
export type ContactParty = ConsentWorkflow['parties'][number];
export type PermissionRecord = ConsentWorkflow['consents'][number];
export type CorrespondenceRecord = ConsentWorkflow['correspondence'][number];
export interface EvidenceDocument { id: string; name: string; mediaType: string; size: number; sha256: string; uploadedAt: string }

export function emptyWorkflow(): ConsentWorkflow {
  return { project: '', requester: '', replyAddress: '', retentionReviewOn: '', titles: [], parties: [], consents: [], correspondence: [] };
}
export function effectiveConsentStatus(permission: PermissionRecord, today = new Date().toISOString().slice(0, 10)): string {
  if (permission.status !== 'granted') return permission.status;
  if (permission.validUntil && permission.validUntil < today) return 'expired';
  if (permission.validFrom && permission.validFrom > today) return 'not yet effective';
  return 'granted';
}
export function validateDocumentReferences(workflow: ConsentWorkflow, documents: EvidenceDocument[]) {
  const references = [...workflow.titles.map(title => title.evidenceRef), ...workflow.parties.map(party => party.authorityEvidence), ...workflow.consents.map(permission => permission.evidenceRef), ...workflow.correspondence.map(entry => entry.evidenceRef)];
  for (const reference of references) if (reference.startsWith('doc:') && !documents.some(document => reference === `doc:${document.id}`)) throw new Error('Evidence references a missing case document');
}