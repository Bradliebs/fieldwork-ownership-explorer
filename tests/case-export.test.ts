import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import wkx from 'wkx';
import { createInvestigationStore } from '../apps/server/src/investigation-store.ts';
import { caseGeoJson, caseGeoPackage } from '../apps/server/src/case-export.ts';
import { buildServer } from '../apps/server/src/server.ts';

const pilot = JSON.parse(readFileSync(new URL('../public/pilot/parcels.json', import.meta.url), 'utf8'));

test('GIS exports preserve coordinates and holes, source provenance and unknown ownership without private case content', () => {
  const store = createInvestigationStore();
  const directory = mkdtempSync(join(tmpdir(), 'fieldwork-gis-test-'));
  let database: DatabaseSync | undefined;
  try {
    const withHole = pilot.parcels.find((parcel: { geometry: { coordinates: unknown[] } }) => parcel.geometry.coordinates.length > 1);
    assert.ok(withHole);
    const parcels = [withHole, pilot.parcels.find((parcel: { id: string }) => parcel.id !== withHole.id)];
    const item = store.create({ name: 'Private case name', notes: 'Private notes', question: 'Private question' }, { dataset: 'pilot', parcel: parcels[0], parcels, manifest: pilot.manifest, releaseSha256: 'captured-source' });
    const json = caseGeoJson(item);
    assert.deepEqual(json.features.map(feature => feature.geometry), parcels.map(parcel => parcel.geometry));
    assert.ok(!JSON.stringify(json).includes('Private'));
    assert.equal(json.features[0].properties.ownership, 'unknown');
    const bytes = caseGeoPackage(item);
    assert.ok(!bytes.includes(Buffer.from('Private')));
    const path = join(directory, 'site.gpkg');
    writeFileSync(path, bytes);
    database = new DatabaseSync(path, { readOnly: true });
    assert.equal(database.prepare('PRAGMA application_id').get()!.application_id, 1196444487);
    assert.equal(database.prepare('PRAGMA user_version').get()!.user_version, 10300);
    assert.equal(database.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok');
    assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(database.prepare('SELECT count(*) AS total FROM gpkg_contents').get()!.total, 4);
    assert.equal(database.prepare('SELECT source_sha256 FROM case_source').get()!.source_sha256, 'captured-source');
    const records = database.prepare('SELECT geom,parcel_id FROM parcels ORDER BY fid').all();
    records.forEach((record, index) => {
      const geometry = Buffer.from(record.geom as Uint8Array);
      assert.equal(geometry.subarray(0, 2).toString(), 'GP');
      assert.equal(geometry.readInt32LE(4), 4326);
      assert.deepEqual(wkx.Geometry.parse(geometry.subarray(8)).toGeoJSON(), parcels[index].geometry);
    });
    assert.equal(store.get(item.id)!.revision, 0);
  } finally { database?.close(); store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('GIS downloads bind to a saved revision and reject unsupported formats and external hosts', async () => {
  const app = buildServer({ port: 4317 });
  const headers = { host: '127.0.0.1:4317' };
  try {
    const { token } = (await app.inject({ url: '/api/session', headers })).json();
    const created = await app.inject({ method: 'POST', url: '/api/investigations', headers: { ...headers, 'x-local-token': token }, payload: { name: 'GIS case', notes: '', question: '', operationId: randomUUID(), parcelId: pilot.parcels[0].id, published: pilot.manifest.published } });
    const id = created.json().investigation.id;
    for (const format of ['geojson', 'gpkg']) {
      const response = await app.inject({ url: `/api/investigations/${id}/gis?revision=0&format=${format}`, headers });
      assert.equal(response.statusCode, 200);
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.match(String(response.headers['content-disposition']), /attachment/);
    }
    assert.equal((await app.inject({ url: `/api/investigations/${id}/gis?revision=1&format=gpkg`, headers })).statusCode, 404);
    assert.equal((await app.inject({ url: `/api/investigations/${id}/gis?revision=0&format=csv`, headers })).statusCode, 400);
    assert.equal((await app.inject({ url: `/api/investigations/${id}/gis?revision=0&format=gpkg`, headers: { host: 'external.invalid' } })).statusCode, 403);
  } finally { await app.close(); }
});