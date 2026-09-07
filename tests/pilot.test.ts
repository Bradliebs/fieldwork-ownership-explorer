import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parcelBounds, parcelStatus, type Parcel } from '../packages/contracts/src/ownership.ts';

test('real geometry bounds preserve location without inventing ownership', () => {
  const parcel: Parcel = { id: 'INSPIRE-123', label: 'INSPIRE 123', revision: 0, links: [],
    source: { name: 'HM Land Registry INSPIRE', url: 'https://use-land-property-data.service.gov.uk/datasets/inspire', published: '2026-09-06', inspireId: '123' },
    geometry: { type: 'Polygon', coordinates: [[[-2.6, 51.4], [-2.59, 51.4], [-2.595, 51.41], [-2.6, 51.4]]] } };
  assert.deepEqual(parcelBounds([parcel]), [[-2.6, 51.4], [-2.59, 51.41]]);
  assert.equal(parcelBounds([]), null);
  assert.equal(parcelStatus(parcel), 'unknown');
});

test('published Bristol extract has real unique geometry, preserved holes and no owner claims', () => {
  const { parcels, manifest } = JSON.parse(readFileSync(new URL('../public/pilot/parcels.json', import.meta.url), 'utf8')) as {
    parcels: Parcel[]; manifest: { count: number; authorityCount: number; published: string; archiveSha256: string; gridSha256: string };
  };
  assert.equal(parcels.length, manifest.count);
  assert.equal(manifest.authorityCount, 159567);
  assert.equal(manifest.published, '2026-09-06');
  assert.ok(parcels.length > 1000);
  assert.equal(new Set(parcels.map(parcel => parcel.id)).size, parcels.length);
  assert.match(manifest.archiveSha256, /^[a-f0-9]{64}$/);
  assert.match(manifest.gridSha256, /^[a-f0-9]{64}$/);
  assert.ok(parcels.some(parcel => parcel.geometry.coordinates.length > 1));
  for (const parcel of parcels) {
    assert.equal(parcel.id, `INSPIRE-${parcel.source?.inspireId}`);
    assert.equal(parcel.source?.published, manifest.published);
    assert.equal(parcelStatus(parcel), 'unknown');
    assert.deepEqual(parcel.links, []);
    for (const ring of parcel.geometry.coordinates) {
      assert.ok(ring.length >= 4);
      assert.deepEqual(ring[0], ring.at(-1));
      for (const [longitude, latitude] of ring) {
        assert.ok(longitude > -2.8 && longitude < -2.4);
        assert.ok(latitude > 51.3 && latitude < 51.7);
      }
    }
  }
});