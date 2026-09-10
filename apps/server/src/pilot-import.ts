import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { rename, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { unzipSync } from 'fflate';
import { fromArrayBuffer } from 'geotiff';
import osmtogeojson from 'osmtogeojson';
import proj4 from 'proj4';
import { SaxesParser } from 'saxes';
import { z } from 'zod';
import { basemapSchema, parcelDatasetSchema, pilotManifestSchema } from '../../../packages/contracts/src/release.ts';
import type { Parcel } from '../../../packages/contracts/src/ownership.ts';

const localSourceSchema = z.object({ path: z.string().min(1), url: z.string().url() }).strict();
const boundsSchema = z.tuple([z.tuple([z.number(), z.number()]), z.tuple([z.number(), z.number()])]);
export const pilotImportMetadataSchema = z.object({
  name: z.string().min(1),
  archive: localSourceSchema,
  parcelSourceUrl: z.string().url(),
  osm: localSourceSchema.extend({ licence: z.string().url(), attribution: z.string().min(1), bounds: boundsSchema }).strict(),
  grid: localSourceSchema,
  selection: boundsSchema,
  selectionMethod: z.string().min(1),
  licence: z.string().url(),
  attribution: z.string().min(1),
  downloadedAt: z.string().datetime({ offset: true }).optional(),
}).strict();

export type PilotImportMetadata = z.infer<typeof pilotImportMetadataSchema>;

function hash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function atomicWrite(path: string, value: unknown): Promise<void> {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, JSON.stringify(value), { flag: 'wx', flush: true });
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(temporaryPath, path);
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (attempt >= 4 || !['EACCES', 'EBUSY', 'EPERM'].includes(code ?? '')) throw error;
        await new Promise(resolveDelay => setTimeout(resolveDelay, 25 * (attempt + 1)));
      }
    }
  } finally { await rm(temporaryPath, { force: true }); }
}

function retainSource(sourceCacheRoot: string, sourcePath: string, bytes: Uint8Array): void {
  mkdirSync(sourceCacheRoot, { recursive: true });
  const name = basename(sourcePath);
  const extension = name.includes('.') ? `.${name.split('.').at(-1)}` : '';
  const destination = join(sourceCacheRoot, `${hash(bytes)}${extension}`);
  try { writeFileSync(destination, bytes, { flag: 'wx', flush: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  if (statSync(destination).size !== bytes.length || hash(readFileSync(destination)) !== hash(bytes)) throw new Error('Retained pilot source does not match its content hash');
}

export async function importPilotRelease(options: { outputRoot: string; sourceCacheRoot: string; metadata: PilotImportMetadata }) {
  const metadata = pilotImportMetadataSchema.parse(options.metadata);
  const archive = readFileSync(metadata.archive.path);
  const grid = readFileSync(metadata.grid.path);
  const osmBuffer = readFileSync(metadata.osm.path);
  retainSource(options.sourceCacheRoot, metadata.archive.path, archive);
  retainSource(options.sourceCacheRoot, metadata.grid.path, grid);
  retainSource(options.sourceCacheRoot, metadata.osm.path, osmBuffer);

  const gridFile = await fromArrayBuffer(Uint8Array.from(grid).buffer);
  proj4.nadgrid('OSTN15', gridFile);
  const projection = '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +nadgrids=OSTN15 +units=m +no_defs';
  const transform = proj4(projection, 'EPSG:4326');
  const lower = transform.inverse(metadata.selection[0]);
  const upper = transform.inverse(metadata.selection[1]);
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
    const eastings = exterior.map(point => point[0]);
    const northings = exterior.map(point => point[1]);
    if (Math.max(...eastings) < lower[0] || Math.min(...eastings) > upper[0] || Math.max(...northings) < lower[1] || Math.min(...northings) > upper[1]) return;
    const coordinates = rings.map(ring => ring.map(point => transform.forward(point)));
    if (!coordinates.flat(2).every(Number.isFinite)) throw new Error('Coordinate transform failed');
    parcels.push({
      id: `INSPIRE-${inspireId}`, label: `INSPIRE ${inspireId}`,
      geometry: { type: 'Polygon', coordinates }, links: [], revision: 0,
      source: { name: 'HM Land Registry INSPIRE', url: metadata.parcelSourceUrl, published, inspireId },
    });
  });
  const decoder = new TextDecoder();
  for (let offset = 0; offset < gml.length; offset += 65_536) parser.write(decoder.decode(gml.subarray(offset, offset + 65_536), { stream: true }));
  parser.write(decoder.decode()).close();
  if (seen !== expected || parcels.length < 10 || parcels.length > 10_000) throw new Error(`Unexpected counts: ${seen}/${expected}, selected ${parcels.length}`);

  const osm = JSON.parse(osmBuffer.toString());
  if (osm.remark || !Array.isArray(osm.elements) || !osm.osm3s?.timestamp_osm_base) throw new Error('Incomplete OSM response');
  const basemap = osmtogeojson(osm, { flatProperties: true });
  for (const feature of basemap.features) {
    const tags = feature.properties ?? {};
    feature.properties = { name: tags.name ?? '', kind: tags.highway ? 'road' : tags.building ? 'building' : tags.natural === 'water' ? 'water' : 'park', highway: tags.highway ?? '' };
  }
  const manifest = pilotManifestSchema.parse({
    name: metadata.name, published, downloaded: metadata.downloadedAt ?? new Date().toISOString(), count: parcels.length, authorityCount: seen,
    selection: metadata.selection, selectionMethod: metadata.selectionMethod,
    sourceUrl: metadata.archive.url, licence: metadata.licence, attribution: metadata.attribution,
    archiveSha256: hash(archive), gridSha256: hash(grid),
    transform: 'EPSG:27700 via OSTN15 to ETRS89, displayed as WGS84 for web mapping only; not survey-grade WGS84 epoch conversion.',
    gridSource: metadata.grid.url,
    osm: { source: metadata.osm.url, published: osm.osm3s.timestamp_osm_base, sha256: hash(osmBuffer), licence: metadata.osm.licence, attribution: metadata.osm.attribution, bounds: metadata.osm.bounds },
  });
  const parcelDataset = parcelDatasetSchema.parse({ parcels, manifest });
  const validatedBasemap = basemapSchema.parse(basemap);
  mkdirSync(options.outputRoot, { recursive: true });
  await atomicWrite(join(options.outputRoot, 'parcels.json'), parcelDataset);
  await atomicWrite(join(options.outputRoot, 'basemap.json'), validatedBasemap);
  await atomicWrite(join(options.outputRoot, 'manifest.json'), manifest);
  return { parcels: parcels.length, basemapFeatures: validatedBasemap.features.length, published, authorityCount: seen };
}