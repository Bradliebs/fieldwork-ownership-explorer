import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
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

export function createStore(journal?: string) {
  const parcels = demoParcels();
  const decisions: Decision[] = [];
  function apply(decision: Decision, persist: boolean) {
    if (!decision || typeof decision.reviewer !== 'string' || !decision.reviewer.trim() ||
      typeof decision.reason !== 'string' || !decision.reason.trim() ||
      !['reviewed', 'rejected', 'pending'].includes(decision.review) || !Number.isInteger(decision.revision)) {
      throw new Error('Invalid review decision');
    }
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