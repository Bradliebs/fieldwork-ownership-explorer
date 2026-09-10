import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
  basemapSchema,
  parcelDatasetSchema,
  pilotManifestSchema,
  releaseBundleSchema,
  salesReleaseSchema,
  type ReleaseBundle,
} from '../../../packages/contracts/src/release.ts';
import { acquireRuntimeLock } from './runtime-lock.ts';

const activeReleaseSchema = z.object({
  active: z.string().min(1),
  previous: z.string().min(1).nullable(),
  activatedAt: z.string().datetime({ offset: true }),
}).strict();

export interface ActiveRelease {
  descriptor: ReleaseBundle;
  path: string;
}

async function renameWithRetry(source: string, destination: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(source, destination);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 4 || !['EACCES', 'EBUSY', 'EPERM'].includes(code ?? '')) throw error;
      await new Promise(resolveDelay => setTimeout(resolveDelay, 25 * (attempt + 1)));
    }
  }
}

async function parseJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function validateRelease(path: string): Promise<ReleaseBundle> {
  const descriptor = releaseBundleSchema.parse(await parseJson(join(path, 'release.json')));
  const content = new Map<string, Buffer>();
  for (const file of descriptor.files) {
    const filePath = join(path, file.path);
    const details = await stat(filePath);
    if (!details.isFile() || details.size !== file.size) throw new Error(`Release file size does not match: ${file.path}`);
    const bytes = await readFile(filePath);
    if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error(`Release file hash does not match: ${file.path}`);
    content.set(file.path, bytes);
  }

  const manifest = pilotManifestSchema.parse(JSON.parse(content.get('manifest.json')!.toString('utf8')));
  const parcels = parcelDatasetSchema.parse(JSON.parse(content.get('parcels.json')!.toString('utf8')));
  const basemap = basemapSchema.parse(JSON.parse(content.get('basemap.json')!.toString('utf8')));
  const sales = salesReleaseSchema.parse(JSON.parse(content.get('sales.json')!.toString('utf8')));
  if (JSON.stringify(parcels.manifest) !== JSON.stringify(manifest)) throw new Error('Parcel and standalone manifests do not match');
  if (manifest.count !== parcels.parcels.length || descriptor.counts.parcels !== parcels.parcels.length) throw new Error('Release parcel count does not match');
  if (descriptor.counts.basemapFeatures !== basemap.features.length) throw new Error('Release basemap count does not match');
  if (descriptor.counts.salesRecords !== sales.records.length) throw new Error('Release sales count does not match');
  const parcelHash = descriptor.files.find(file => file.path === 'parcels.json')!.sha256;
  if (sales.pilotSha256 !== parcelHash || descriptor.compatibility.salesRequiresParcelsSha256 !== parcelHash) throw new Error('Sales release does not match parcel geometry');
  const parcelIds = new Set<string>();
  const inspireIds = new Set<string>();
  for (const parcel of parcels.parcels) {
    if (parcelIds.has(parcel.id) || inspireIds.has(parcel.source.inspireId)) throw new Error('Release contains duplicate parcel identifiers');
    parcelIds.add(parcel.id);
    inspireIds.add(parcel.source.inspireId);
    for (const ring of parcel.geometry.coordinates) for (const [longitude, latitude] of ring) {
      const [[west, south], [east, north]] = descriptor.bounds;
      if (longitude < west || longitude > east || latitude < south || latitude > north) throw new Error('Parcel geometry falls outside release bounds');
    }
  }
  const transactionIds = new Set<string>();
  for (const record of sales.records) {
    if (transactionIds.has(record.transactionId)) throw new Error('Release contains duplicate sale transactions');
    transactionIds.add(record.transactionId);
    if (record.inspireIds.some(id => !inspireIds.has(id))) throw new Error('Sales release references a missing parcel');
  }
  const sources = Object.fromEntries(descriptor.sources.map(source => [source.kind, source]));
  if (sources.parcels.period !== manifest.published || !sources.parcels.urls.includes(manifest.sourceUrl) || sources.parcels.licence !== manifest.licence || sources.parcels.attribution !== manifest.attribution) throw new Error('Parcel source provenance does not match release descriptor');
  if (sources.basemap.period !== manifest.osm.published || !sources.basemap.urls.includes(manifest.osm.source) || sources.basemap.licence !== manifest.osm.licence || sources.basemap.attribution !== manifest.osm.attribution) throw new Error('Basemap source provenance does not match release descriptor');
  if (sources.sales.period !== sales.period || sales.sources.some(source => !sources.sales.urls.includes(source.url)) || sources.sales.licence !== sales.licence || sources.sales.attribution !== sales.attribution) throw new Error('Sales source provenance does not match release descriptor');
  if (descriptor.crs.transform !== manifest.transform || descriptor.crs.grid.url !== manifest.gridSource || descriptor.crs.grid.sha256 !== manifest.gridSha256) throw new Error('Release coordinate transform does not match parcel manifest');
  if (JSON.stringify(descriptor.bounds) !== JSON.stringify(manifest.osm.bounds)) throw new Error('Release bounds do not match parcel manifest');
  return descriptor;
}

export function createReleaseStore(options: { root: string; runtimeLock: string }) {
  const releasesRoot = join(options.root, 'releases');
  const activePath = join(options.root, 'active-release.json');

  async function readActivePointer() {
    try { return activeReleaseSchema.parse(await parseJson(activePath)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async function writeActivePointer(pointer: z.infer<typeof activeReleaseSchema>): Promise<void> {
    await mkdir(options.root, { recursive: true });
    const temporaryPath = `${activePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(pointer, null, 2)}\n`, { flag: 'wx', flush: true });
      await renameWithRetry(temporaryPath, activePath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }

  async function getRelease(releaseId: string): Promise<ActiveRelease> {
    const path = join(releasesRoot, releaseId);
    const descriptor = await validateRelease(path);
    if (descriptor.releaseId !== releaseId) throw new Error('Release directory does not match its descriptor');
    return { descriptor, path };
  }

  return {
    async stage(sourceRoot: string): Promise<ActiveRelease> {
      const descriptor = releaseBundleSchema.parse(await parseJson(join(sourceRoot, 'release.json')));
      await mkdir(releasesRoot, { recursive: true });
      const destination = join(releasesRoot, descriptor.releaseId);
      try {
        await stat(destination);
        throw new Error(`Release already exists: ${descriptor.releaseId}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      const staging = join(options.root, `.release-staging-${randomUUID()}`);
      await mkdir(staging, { recursive: false });
      try {
        await copyFile(join(sourceRoot, 'release.json'), join(staging, 'release.json'));
        for (const file of descriptor.files) await copyFile(join(sourceRoot, file.path), join(staging, file.path));
        const validated = await validateRelease(staging);
        await renameWithRetry(staging, destination);
        return { descriptor: validated, path: destination };
      } finally {
        await rm(staging, { recursive: true, force: true });
      }
    },

    async initialize(sourceRoot: string, runtimeLockHeld = false): Promise<ActiveRelease> {
      const current = await readActivePointer();
      if (current) return getRelease(current.active);
      const descriptor = releaseBundleSchema.parse(await parseJson(join(sourceRoot, 'release.json')));
      let release: ActiveRelease;
      try { release = await getRelease(descriptor.releaseId); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        release = await this.stage(sourceRoot);
      }
      if (JSON.stringify(release.descriptor) !== JSON.stringify(descriptor)) throw new Error('Bundled release conflicts with the staged release identifier');
      if (runtimeLockHeld) {
        await writeActivePointer({ active: descriptor.releaseId, previous: null, activatedAt: new Date().toISOString() });
        return release;
      }
      return this.activate(descriptor.releaseId);
    },

    async activate(releaseId: string): Promise<ActiveRelease> {
      const releaseOperationLock = acquireRuntimeLock(options.runtimeLock);
      try {
        const release = await getRelease(releaseId);
        const current = await readActivePointer();
        if (current?.active === releaseId) throw new Error(`Release is already active: ${releaseId}`);
        await writeActivePointer({ active: releaseId, previous: current?.active ?? null, activatedAt: new Date().toISOString() });
        return release;
      } finally { releaseOperationLock(); }
    },

    async active(): Promise<ActiveRelease | undefined> {
      const pointer = await readActivePointer();
      return pointer ? getRelease(pointer.active) : undefined;
    },

    async rollback(): Promise<ActiveRelease> {
      const releaseOperationLock = acquireRuntimeLock(options.runtimeLock);
      try {
        const current = await readActivePointer();
        if (!current?.previous) throw new Error('No previous release is available for rollback');
        const previous = await getRelease(current.previous);
        await writeActivePointer({ active: current.previous, previous: current.active, activatedAt: new Date().toISOString() });
        return previous;
      } finally { releaseOperationLock(); }
    },
  };
}