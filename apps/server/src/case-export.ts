import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import wkx from 'wkx';
import type { Investigation } from '../../../packages/contracts/src/investigation.ts';
import { parcelBounds } from '../../../packages/contracts/src/ownership.ts';

const notice = 'Indicative INSPIRE extent, not a legal boundary. Ownership unknown. Case assessments are not works clearance. Contact details, notes and evidence bytes excluded.';

export function caseGeoJson(item: Investigation) {
  const parcels = item.snapshot.parcels ?? [item.snapshot.parcel];
  return { type: 'FeatureCollection' as const, features: parcels.map(parcel => ({
    type: 'Feature' as const, id: parcel.id, geometry: parcel.geometry,
    properties: { parcel_id: parcel.id, inspire_id: parcel.source?.inspireId ?? '', case_id: item.id,
      revision: item.revision, ownership: 'unknown', source_date: item.snapshot.manifest.published,
      source_sha256: item.snapshot.releaseSha256, attribution: item.snapshot.manifest.attribution,
      source_url: item.snapshot.manifest.sourceUrl, licence: item.snapshot.manifest.licence, transform: item.snapshot.manifest.transform, notice },
  })) };
}

export function caseGeoPackage(item: Investigation): Buffer {
  const directory = mkdtempSync(join(tmpdir(), 'fieldwork-gis-'));
  const path = join(directory, 'case.gpkg');
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(path);
    database.exec(`PRAGMA application_id = 1196444487; PRAGMA user_version = 10300; PRAGMA foreign_keys = ON;
      CREATE TABLE gpkg_spatial_ref_sys (srs_name TEXT NOT NULL, srs_id INTEGER NOT NULL PRIMARY KEY, organization TEXT NOT NULL, organization_coordsys_id INTEGER NOT NULL, definition TEXT NOT NULL, description TEXT);
      CREATE TABLE gpkg_contents (table_name TEXT NOT NULL PRIMARY KEY, data_type TEXT NOT NULL, identifier TEXT UNIQUE, description TEXT DEFAULT '', last_change DATETIME NOT NULL, min_x DOUBLE, min_y DOUBLE, max_x DOUBLE, max_y DOUBLE, srs_id INTEGER, FOREIGN KEY(srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id));
      CREATE TABLE gpkg_geometry_columns (table_name TEXT NOT NULL, column_name TEXT NOT NULL, geometry_type_name TEXT NOT NULL, srs_id INTEGER NOT NULL, z TINYINT NOT NULL, m TINYINT NOT NULL, PRIMARY KEY(table_name,column_name), FOREIGN KEY(table_name) REFERENCES gpkg_contents(table_name), FOREIGN KEY(srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id));
      CREATE TABLE parcels (fid INTEGER PRIMARY KEY, geom BLOB NOT NULL, parcel_id TEXT NOT NULL UNIQUE, inspire_id TEXT NOT NULL, ownership TEXT NOT NULL);
      CREATE TABLE case_source (fid INTEGER PRIMARY KEY, case_id TEXT NOT NULL, revision INTEGER NOT NULL, source_date TEXT NOT NULL, source_sha256 TEXT NOT NULL, attribution TEXT NOT NULL, source_url TEXT NOT NULL, licence TEXT NOT NULL, transform TEXT NOT NULL, notice TEXT NOT NULL);
      CREATE TABLE title_scope (fid INTEGER PRIMARY KEY, title_id TEXT NOT NULL, title_number TEXT NOT NULL, verification TEXT NOT NULL, parcel_id TEXT NOT NULL, FOREIGN KEY(parcel_id) REFERENCES parcels(parcel_id));
      CREATE TABLE request_scope (fid INTEGER PRIMARY KEY, request_id TEXT NOT NULL, party_id TEXT NOT NULL, recorded_status TEXT NOT NULL, valid_from TEXT NOT NULL, valid_until TEXT NOT NULL, parcel_id TEXT NOT NULL, FOREIGN KEY(parcel_id) REFERENCES parcels(parcel_id));
      BEGIN IMMEDIATE;`);
    const insertSrs = database.prepare('INSERT INTO gpkg_spatial_ref_sys VALUES (?, ?, ?, ?, ?, ?)');
    insertSrs.run('Undefined Cartesian', -1, 'NONE', -1, 'undefined', 'Undefined Cartesian coordinate reference system');
    insertSrs.run('Undefined Geographic', 0, 'NONE', 0, 'undefined', 'Undefined geographic coordinate reference system');
    insertSrs.run('WGS 84', 4326, 'EPSG', 4326, 'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433],AUTHORITY["EPSG","4326"]]', 'Longitude, latitude in degrees');
    const parcels = item.snapshot.parcels ?? [item.snapshot.parcel];
    const bounds = parcelBounds(parcels)!;
    const contents = database.prepare('INSERT INTO gpkg_contents VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    contents.run('parcels', 'features', 'Saved case parcels', notice, item.updatedAt, ...bounds[0], ...bounds[1], 4326);
    for (const table of ['case_source', 'title_scope', 'request_scope']) contents.run(table, 'attributes', table, notice, item.updatedAt, null, null, null, null, null);
    database.prepare('INSERT INTO gpkg_geometry_columns VALUES (?, ?, ?, ?, ?, ?)').run('parcels', 'geom', 'POLYGON', 4326, 0, 0);
    const insertParcel = database.prepare('INSERT INTO parcels (geom, parcel_id, inspire_id, ownership) VALUES (?, ?, ?, ?)');
    for (const parcel of parcels) {
      const header = Buffer.alloc(8);
      header.write('GP', 0, 'ascii'); header[3] = 1; header.writeInt32LE(4326, 4);
      insertParcel.run(Buffer.concat([header, wkx.Geometry.parseGeoJSON(parcel.geometry).toWkb()]), parcel.id, parcel.source?.inspireId ?? '', 'unknown');
    }
    database.prepare('INSERT INTO case_source (case_id, revision, source_date, source_sha256, attribution, source_url, licence, transform, notice) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(item.id, item.revision, item.snapshot.manifest.published, item.snapshot.releaseSha256, item.snapshot.manifest.attribution, item.snapshot.manifest.sourceUrl, item.snapshot.manifest.licence, item.snapshot.manifest.transform, notice);
    const scope = (ids?: string[]) => ids ?? (parcels.length === 1 ? [parcels[0].id] : []);
    const titleInsert = database.prepare('INSERT INTO title_scope (title_id, title_number, verification, parcel_id) VALUES (?, ?, ?, ?)');
    for (const title of item.workflow.titles) for (const parcelId of scope(title.parcelIds)) titleInsert.run(title.id, title.titleNumber, title.verification, parcelId);
    const requestInsert = database.prepare('INSERT INTO request_scope (request_id, party_id, recorded_status, valid_from, valid_until, parcel_id) VALUES (?, ?, ?, ?, ?, ?)');
    for (const request of item.workflow.consents) for (const parcelId of scope(request.parcelIds)) requestInsert.run(request.id, request.partyId, request.status, request.validFrom, request.validUntil, parcelId);
    database.exec('COMMIT');
    database.close(); database = undefined;
    return readFileSync(path);
  } finally { database?.close(); rmSync(directory, { recursive: true, force: true }); }
}