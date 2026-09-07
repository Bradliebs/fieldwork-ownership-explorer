export type Interest = 'freehold' | 'leasehold' | 'managed' | 'occupied';
export type MatchStatus = 'verified' | 'candidate' | 'ambiguous';
export type ReviewStatus = 'pending' | 'reviewed' | 'rejected';

export interface PilotManifest {
  name: string;
  published: string;
  count: number;
  sourceUrl: string;
  licence: string;
  attribution: string;
  transform: string;
  osm: { published: string; licence: string; attribution: string };
}

export interface Evidence {
  id: string;
  source: string;
  sourceDate: string;
  reference: string;
  method: 'documentary' | 'address' | 'overlap';
  scope: 'whole' | 'partial';
  interest: Interest;
  establishesRelationship: boolean;
}

export interface OwnershipLink {
  id: string;
  titleNumber: string | null;
  proprietors: string[];
  interest: Interest;
  status: MatchStatus;
  review: ReviewStatus;
  evidence: Evidence[];
}

export interface Parcel {
  id: string;
  label: string;
  geometry: { type: 'Polygon'; coordinates: number[][][] };
  source?: { name: string; url: string; published: string; inspireId: string };
  links: OwnershipLink[];
  revision: number;
}

export function parcelBounds(parcels: Parcel[]): [[number, number], [number, number]] | null {
  if (!parcels.length) return null;
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const parcel of parcels) for (const ring of parcel.geometry.coordinates) for (const [longitude, latitude] of ring) {
    west = Math.min(west, longitude); east = Math.max(east, longitude);
    south = Math.min(south, latitude); north = Math.max(north, latitude);
  }
  return Number.isFinite(west + south + east + north) ? [[west, south], [east, north]] : null;
}

export function validateLink(link: OwnershipLink): void {
  if (link.proprietors.length === 0 || link.proprietors.some(name => !name.trim())) {
    throw new Error('A link must preserve its reported proprietors.');
  }
  if (!link.evidence.length || link.evidence.some(item => !item.reference.trim())) {
    throw new Error('Source evidence is required.');
  }
  if (link.status === 'verified' && !link.evidence.some(item =>
    item.method === 'documentary' && item.scope === 'whole' &&
    item.interest === link.interest && item.establishesRelationship &&
    Boolean(item.source.trim()) && /^\d{4}-\d{2}-\d{2}$/.test(item.sourceDate)
  )) {
    throw new Error('Verification requires documentary evidence for this whole-parcel interest.');
  }
}

export function reviewLink(link: OwnershipLink, review: ReviewStatus): OwnershipLink {
  validateLink(link);
  return { ...link, review };
}

export function parcelStatus(parcel: Parcel): MatchStatus | 'unknown' {
  const active = parcel.links.filter(link => link.review !== 'rejected');
  if (!active.length) return 'unknown';
  if (active.some(link => link.status === 'ambiguous')) return 'ambiguous';
  if (active.some(link => link.status === 'candidate')) return 'candidate';
  return 'verified';
}