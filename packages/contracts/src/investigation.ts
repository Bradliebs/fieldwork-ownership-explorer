import type { Parcel, PilotManifest } from './ownership.ts';
import type { SalesRelease } from './sales.ts';
import type { ConsentWorkflow, EvidenceDocument } from './consent.ts';

export interface InvestigationSnapshot {
  dataset: 'pilot';
  releaseSha256: string;
  parcel: Parcel;
  manifest: PilotManifest;
  sales?: SalesRelease;
}

export interface Investigation {
  id: string;
  name: string;
  question: string;
  notes: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  snapshot: InvestigationSnapshot;
  workflow: ConsentWorkflow;
  documents: EvidenceDocument[];
}

export interface InvestigationSummary {
  id: string;
  name: string;
  parcelId: string;
  updatedAt: string;
  revision: number;
}

export interface InvestigationEdit {
  name: string;
  question: string;
  notes: string;
  workflow?: ConsentWorkflow;
}

export interface InvestigationEvent {
  revision: number;
  action: 'created' | 'updated' | 'document added';
  at: string;
}