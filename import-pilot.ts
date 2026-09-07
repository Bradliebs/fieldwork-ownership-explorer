import { readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { SaxesParser } from 'saxes';
import proj4 from 'proj4';
import { fromArrayBuffer } from 'geotiff';
import osmtogeojson from 'osmtogeojson';
import type { Parcel } from './packages/contracts/src/ownership.ts';

const [archivePath, osmPath, gridPath] = process.argv.slice(2);
if (!archivePath || !osmPath || !gridPath) throw new Error('Usage: node --import tsx import-pilot.ts Bristol.zip osm.json OSTN15.tif');
const archive = readFileSync(archivePath);
const grid = readFileSync(gridPath);
await proj4.nadgrid('OSTN15', await fromArrayBuffer(Uint8Array.from(grid).buffer)).ready;
const projection = '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +nadgrids=OSTN15 +units=m +no_defs';
const transform = proj4(projection, 'EPSG:4326');
const selection = [[-2.610, 51.447], [-2.588, 51.456]];
const lower = transform.inverse(selection[0]), upper = transform.inverse(selection[1]);
const files = unzipSync(archive, { filter: entry => entry.name === 'Land_Registry_Cadastral_Parcels.gml' && entry.originalSize < 250_000_000 });
const gml = files['Land_Registry_Cadastral_Parcels.gml'];
if (!gml) throw new Error('Expected bounded GML archive member missing');
const parcels: Parcel[] = [];
const ids = new Set<string>();
let published = '', inspireId = '', text = '', polygonCount = 0, seen = 0, expected = 0;
let rings: number[][][] = [];
const parser = new SaxesParser({ xmlns: false });
parser.on('doctype', () => { throw new Error('DOCTYPE is not supported'); });
parser.on('opentag', tag => {
  text = '';
  if (tag.name === 'wfs:FeatureCollection') {
    published = String(tag.attributes.timeStamp).slice(0, 10);
    expected = Number(tag.attributes.numberReturned);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(published) || !Number.isSafeInteger(expected)) throw new Error('Missing release metadata');
  }
  if (tag.name === 'wfs:member') { inspireId = ''; rings = []; polygonCount = 0; }
  if (tag.name === 'gml:Polygon') {
    polygonCount++;
    if (tag.attributes.srsName !== 'urn:ogc:def:crs:EPSG::27700' || tag.attributes.srsDimension !== '2') throw new Error('Unsupported source CRS');
  }
});
parser.on('text', value => { text += value; });
parser.on('closetag', tag => {
  if (tag.name === 'LR:INSPIREID') inspireId = text.trim();
  if (tag.name === 'gml:posList') {
    const ordinates = text.trim().split(/\s+/).map(Number);
    if (ordinates.length < 8 || ordinates.length % 2 || !ordinates.every(Number.isFinite)) throw new Error('Malformed ring');
    const ring: number[][] = [];
    for (let offset = 0; offset < ordinates.length; offset += 2) ring.push([ordinates[offset], ordinates[offset + 1]]);
    if (ring[0][0] !== ring.at(-1)![0] || ring[0][1] !== ring.at(-1)![1]) throw new Error('Unclosed ring');
    rings.push(ring);
  }
  if (tag.name !== 'wfs:member') return;
  seen++;
  if (!/^\d+$/.test(inspireId) || polygonCount !== 1 || !rings.length || ids.has(inspireId)) throw new Error('Unsupported or duplicate feature');
  ids.add(inspireId);
  const exterior = rings[0];
  const eastings = exterior.map(point => point[0]), northings = exterior.map(point => point[1]);
  if (Math.max(...eastings) < lower[0] || Math.min(...eastings) > upper[0] || Math.max(...northings) < lower[1] || Math.min(...northings) > upper[1]) return;
  const coordinates = rings.map(ring => ring.map(point => transform.forward(point)));
  if (!coordinates.flat(2).every(Number.isFinite)) throw new Error('Coordinate transform failed');
  parcels.push({ id: `INSPIRE-${inspireId}`, label: `INSPIRE ${inspireId}`, geometry: { type: 'Polygon', coordinates }, links: [], revision: 0,
    source: { name: 'HM Land Registry INSPIRE', url: 'https://use-land-property-data.service.gov.uk/datasets/inspire', published, inspireId } });
});
const decoder = new TextDecoder();
for (let offset = 0; offset < gml.length; offset += 65536) parser.write(decoder.decode(gml.subarray(offset, offset + 65536), { stream: true }));
parser.write(decoder.decode()).close();
if (seen !== expected || parcels.length < 10 || parcels.length > 10000) throw new Error(`Unexpected counts: ${seen}/${expected}, selected ${parcels.length}`);
const osmBuffer = readFileSync(osmPath);
const osm = JSON.parse(osmBuffer.toString());
if (osm.remark || !Array.isArray(osm.elements) || !osm.osm3s?.timestamp_osm_base) throw new Error('Incomplete OSM response');
const basemap = osmtogeojson(osm, { flatProperties: true });
for (const feature of basemap.features) {
  const tags = feature.properties ?? {};
  feature.properties = { name: tags.name ?? '', kind: tags.highway ? 'road' : tags.building ? 'building' : tags.natural === 'water' ? 'water' : 'park', highway: tags.highway ?? '' };
}
const attribution = 'This information is subject to Crown copyright and database rights 2026 and is reproduced with the permission of HM Land Registry. The polygons (including the associated geometry, namely x, y co-ordinates) are subject to Crown copyright and database rights 2026 Ordnance Survey AC0000851063.';
const manifest = { name: 'Bristol Harbourside', published, downloaded: new Date().toISOString(), count: parcels.length, authorityCount: seen,
  selection, selectionMethod: 'Whole polygons whose British National Grid bounding boxes overlap the pilot envelope; not clipped.',
  sourceUrl: 'https://use-land-property-data.service.gov.uk/datasets/inspire/download/Bristol_City_Council.zip',
  licence: 'https://use-land-property-data.service.gov.uk/datasets/inspire/#conditions', attribution,
  archiveSha256: createHash('sha256').update(archive).digest('hex'), gridSha256: createHash('sha256').update(grid).digest('hex'),
  transform: 'EPSG:27700 via OSTN15 to ETRS89, displayed as WGS84 for web mapping only; not survey-grade WGS84 epoch conversion.',
  gridSource: 'https://cdn.proj.org/uk_os_OSTN15_NTv2_OSGBtoETRS.tif',
  osm: { source: 'https://overpass-api.de/api/interpreter', published: osm.osm3s.timestamp_osm_base, sha256: createHash('sha256').update(osmBuffer).digest('hex'), licence: 'https://www.openstreetmap.org/copyright', attribution: '(c) OpenStreetMap contributors, ODbL 1.0', bounds: [[-2.620, 51.440], [-2.580, 51.460]] } };
const directory = join('public', 'pilot');
mkdirSync(directory, { recursive: true });
for (const [name, value] of Object.entries({ parcels: { parcels, manifest }, basemap, manifest })) {
  const destination = join(directory, `${name}.json`);
  writeFileSync(`${destination}.tmp`, JSON.stringify(value));
  renameSync(`${destination}.tmp`, destination);
}
console.log(JSON.stringify({ parcels: parcels.length, basemapFeatures: basemap.features.length, published, authorityCount: seen }));