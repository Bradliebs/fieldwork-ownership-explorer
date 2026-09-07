import { validateLink, type Parcel, type OwnershipLink } from '../../../packages/contracts/src/ownership.ts';

export function demoParcels(): Parcel[] {
  const names = ['North meadow', 'Workshop yard', 'Riverside plots', 'East woodland', 'Station garden', 'Mill buildings', 'South paddock', 'Community gardens', 'West depot', 'Orchard plots', 'Canal-side store', 'Lower pasture'];
  return names.map((label, index) => {
    const west = -2.62 + (index % 4) * 0.006;
    const south = 51.44 + Math.floor(index / 4) * 0.004;
    const status = index % 4 === 0 ? 'verified' : index % 4 === 1 ? 'candidate' : 'ambiguous';
    const interest = index === 3 ? 'managed' : index === 6 ? 'leasehold' : 'freehold';
    const link: OwnershipLink = {
      id: `demo-link-${index + 1}`, titleNumber: interest === 'managed' ? null : `DEMO${String(index + 1).padStart(4, '0')}`,
      proprietors: index === 4 ? ['Example Land Holdings Ltd', 'Example Joint Estates Ltd'] : [interest === 'managed' ? 'Example Woodland Service' : index % 2 ? 'Example Borough Council' : 'Example Land Holdings Ltd'],
      interest, status, review: 'pending',
      evidence: [{ id: `demo-evidence-${index + 1}`, source: 'Synthetic fixture', sourceDate: '2026-09-06',
        reference: `fixture:parcel-${index + 1}`, method: status === 'verified' ? 'documentary' : index % 2 ? 'overlap' : 'address',
        scope: status === 'verified' ? 'whole' : 'partial', interest, establishesRelationship: status === 'verified' }],
    };
    validateLink(link);
    return {
      id: `DEMO-${String(index + 1).padStart(3, '0')}`, label, revision: 0,
      geometry: { type: 'Polygon', coordinates: [[[west, south], [west + 0.0048, south + 0.0002], [west + 0.0045, south + 0.003], [west + 0.0003, south + 0.0033], [west, south]]] },
      links: index === 7 || index === 11 ? [] : [link],
    };
  });
}