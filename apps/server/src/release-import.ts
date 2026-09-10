import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { z } from 'zod';
import {
  basemapSchema,
  parcelDatasetSchema,
  pilotManifestSchema,
  releaseBundleSchema,
  salesReleaseSchema,
  type ReleaseBundle,
} from '../../../packages/contracts/src/release.ts';
import type { SalesRelease } from '../../../packages/contracts/src/sales.ts';
import { joinSales } from './sales-import.ts';

const localSourceSchema = z.object({ path: z.string().min(1), url: z.string().url() }).strict();
export const salesImportMetadataSchema = z.object({
  releaseId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  period: z.string().regex(/^\d{4}-\d{2}$/),
  lookup: localSourceSchema,
  pricePaid: localSourceSchema,
  licence: z.string().url(),
  attribution: z.string().min(1),
  addressConditions: z.string().url(),
  importedAt: z.string().datetime({ offset: true }).optional(),
  importToolVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
}).strict();

export type SalesImportMetadata = z.infer<typeof salesImportMetadataSchema>;

function hash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function atomicWrite(path: string, bytes: Uint8Array): Promise<void> {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, bytes, { flag: 'wx', flush: true });
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

async function fileFact(root: string, path: 'manifest.json' | 'parcels.json' | 'basemap.json' | 'sales.json') {
  const bytes = await readFile(join(root, path));
  return { path, size: bytes.length, sha256: hash(bytes) };
}

export async function finalizeRelease(root: string, releaseId: string, importToolVersion: string, createdAt: string): Promise<ReleaseBundle> {
  const manifest = pilotManifestSchema.parse(JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')));
  const parcels = parcelDatasetSchema.parse(JSON.parse(await readFile(join(root, 'parcels.json'), 'utf8')));
  const basemap = basemapSchema.parse(JSON.parse(await readFile(join(root, 'basemap.json'), 'utf8')));
  const sales = salesReleaseSchema.parse(JSON.parse(await readFile(join(root, 'sales.json'), 'utf8')));
  const files = await Promise.all([
    fileFact(root, 'manifest.json'), fileFact(root, 'parcels.json'),
    fileFact(root, 'basemap.json'), fileFact(root, 'sales.json'),
  ]);
  const parcelSha256 = files.find(file => file.path === 'parcels.json')!.sha256;
  if (sales.pilotSha256 !== parcelSha256) throw new Error('Sales release does not match parcel geometry');
  const descriptor = releaseBundleSchema.parse({
    releaseId,
    schemaVersion: 1,
    createdAt,
    importTool: { name: 'fieldwork-ownership-explorer', version: importToolVersion },
    sources: [
      { kind: 'parcels', period: manifest.published, urls: [manifest.sourceUrl], licence: manifest.licence, attribution: manifest.attribution },
      { kind: 'basemap', period: manifest.osm.published, urls: [manifest.osm.source], licence: manifest.osm.licence, attribution: manifest.osm.attribution },
      { kind: 'sales', period: sales.period, urls: sales.sources.map(source => source.url), licence: sales.licence, attribution: sales.attribution },
    ],
    files,
    crs: { source: 'EPSG:27700', display: 'WGS84', transform: manifest.transform, grid: { url: manifest.gridSource, sha256: manifest.gridSha256 } },
    counts: { parcels: parcels.parcels.length, basemapFeatures: basemap.features.length, salesRecords: sales.records.length },
    bounds: manifest.osm.bounds,
    compatibility: { salesRequiresParcelsSha256: parcelSha256 },
  });
  await atomicWrite(join(root, 'release.json'), Buffer.from(`${JSON.stringify(descriptor, null, 2)}\n`));
  return descriptor;
}

export async function importSalesRelease(options: { outputRoot: string; sourceCacheRoot: string; metadata: SalesImportMetadata }): Promise<{ release: SalesRelease; descriptor: ReleaseBundle }> {
  const metadata = salesImportMetadataSchema.parse(options.metadata);
  const [lookup, pricePaid, pilotRaw] = await Promise.all([
    readFile(metadata.lookup.path), readFile(metadata.pricePaid.path), readFile(join(options.outputRoot, 'parcels.json')),
  ]);
  if (lookup.length > 100_000_000 || pricePaid.length > 100_000_000) throw new Error('Unexpectedly large sales source file');
  const pilot = parcelDatasetSchema.parse(JSON.parse(pilotRaw.toString('utf8')));
  const release = salesReleaseSchema.parse({
    period: metadata.period,
    importedAt: metadata.importedAt ?? new Date().toISOString(),
    pilotSha256: hash(pilotRaw),
    sources: [
      { url: metadata.lookup.url, sha256: hash(lookup) },
      { url: metadata.pricePaid.url, sha256: hash(pricePaid) },
    ],
    attribution: metadata.attribution,
    licence: metadata.licence,
    addressConditions: metadata.addressConditions,
    records: joinSales(lookup.toString('utf8'), pricePaid.toString('utf8'), new Set(pilot.parcels.map(parcel => parcel.source.inspireId))),
  });

  await mkdir(options.sourceCacheRoot, { recursive: true });
  for (const [source, bytes] of [[metadata.lookup, lookup], [metadata.pricePaid, pricePaid]] as const) {
    const extension = basename(source.path).includes('.') ? `.${basename(source.path).split('.').at(-1)}` : '';
    const destination = join(options.sourceCacheRoot, `${hash(bytes)}${extension}`);
    try { await copyFile(source.path, destination, 1); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    if ((await stat(destination)).size !== bytes.length || hash(await readFile(destination)) !== hash(bytes)) throw new Error('Retained sales source does not match its content hash');
  }

  await mkdir(options.outputRoot, { recursive: true });
  await atomicWrite(join(options.outputRoot, 'sales.json'), Buffer.from(`${JSON.stringify(release, null, 2)}\n`));
  const descriptor = await finalizeRelease(options.outputRoot, metadata.releaseId, metadata.importToolVersion, release.importedAt);
  return { release, descriptor };
}