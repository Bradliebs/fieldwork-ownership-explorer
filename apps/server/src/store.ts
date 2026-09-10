import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createReadStream } from 'node:fs';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { demoParcels } from './fixtures.ts';
import { reviewLink, type ReviewStatus } from '../../../packages/contracts/src/ownership.ts';

export interface Decision {
  parcelId: string;
  linkId: string;
  revision: number;
  review: ReviewStatus;
  reviewer: string;
  reason: string;
  at: string;
}

function validateDecision(decision: Decision): void {
  if (!decision || typeof decision.reviewer !== 'string' || !decision.reviewer.trim() ||
    typeof decision.reason !== 'string' || !decision.reason.trim() ||
    !['reviewed', 'rejected', 'pending'].includes(decision.review) || !Number.isInteger(decision.revision)) {
    throw new Error('Invalid review decision');
  }
}

export async function validateReviewJournal(journal: string): Promise<void> {
  const revisions = new Map(demoParcels().map(parcel => [parcel.id, parcel.revision]));
  const links = new Map(demoParcels().flatMap(parcel => parcel.links.map(link => [`${parcel.id}\0${link.id}`, true])));
  const lines = createInterface({ input: createReadStream(journal), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line) continue;
    const decision = JSON.parse(line) as Decision;
    validateDecision(decision);
    const revision = revisions.get(decision.parcelId);
    if (revision === undefined || !links.has(`${decision.parcelId}\0${decision.linkId}`)) throw new Error('Unknown parcel or link');
    if (revision !== decision.revision) throw new Error('Revision conflict');
    revisions.set(decision.parcelId, revision + 1);
  }
}

export function createStore(journal?: string) {
  const parcels = demoParcels();
  const decisions: Decision[] = [];
  function apply(decision: Decision, persist: boolean) {
    validateDecision(decision);
    const parcel = parcels.find(item => item.id === decision.parcelId);
    const index = parcel?.links.findIndex(link => link.id === decision.linkId) ?? -1;
    if (!parcel || index === -1) throw new Error('Unknown parcel or link');
    if (parcel.revision !== decision.revision) throw new Error('Revision conflict');
    const updated = reviewLink(parcel.links[index], decision.review);
    if (persist && journal) {
      mkdirSync(dirname(journal), { recursive: true });
      appendFileSync(journal, JSON.stringify(decision) + '\n', { encoding: 'utf8', flush: true });
    }
    parcel.links[index] = updated;
    parcel.revision += 1;
    decisions.push(decision);
  }
  if (journal && existsSync(journal)) {
    for (const line of readFileSync(journal, 'utf8').split('\n').filter(Boolean)) {
      apply(JSON.parse(line) as Decision, false);
    }
  }
  return { parcels, decisions, save: (decision: Decision) => apply(decision, true) };
}