import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { releaseBundleSchema } from '../packages/contracts/src/release.ts';
import { createReleaseStore } from '../apps/server/src/release-store.ts';
import { acquireRuntimeLock } from '../apps/server/src/runtime-lock.ts';
import { createInvestigationStore } from '../apps/server/src/investigation-store.ts';

const pilotRoot = resolve('public/pilot');

function candidate(root: string, releaseId: string): string {
  const path = resolve(root, releaseId);
  cpSync(pilotRoot, path, { recursive: true });
  const descriptorPath = resolve(path, 'release.json');
  const descriptor = JSON.parse(readFileSync(descriptorPath, 'utf8'));
  descriptor.releaseId = releaseId;
  writeFileSync(descriptorPath, `${JSON.stringify(descriptor, null, 2)}\n`);
  return path;
}

function updateDescriptorFile(candidateRoot: string, fileName: string): void {
  const descriptorPath = resolve(candidateRoot, 'release.json');
  const descriptor = JSON.parse(readFileSync(descriptorPath, 'utf8'));
  const bytes = readFileSync(resolve(candidateRoot, fileName));
  const file = descriptor.files.find((entry: { path: string }) => entry.path === fileName);
  file.size = bytes.length;
  file.sha256 = createHash('sha256').update(bytes).digest('hex');
  writeFileSync(descriptorPath, `${JSON.stringify(descriptor, null, 2)}\n`);
}

function advanceParcelPeriod(candidateRoot: string, published: string): void {
  const manifestPath = resolve(candidateRoot, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.published = published;
  writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);

  const parcelsPath = resolve(candidateRoot, 'parcels.json');
  const parcels = JSON.parse(readFileSync(parcelsPath, 'utf8'));
  parcels.manifest = manifest;
  for (const parcel of parcels.parcels) parcel.source.published = published;
  writeFileSync(parcelsPath, JSON.stringify(parcels));
  const parcelSha256 = createHash('sha256').update(readFileSync(parcelsPath)).digest('hex');

  const salesPath = resolve(candidateRoot, 'sales.json');
  const sales = JSON.parse(readFileSync(salesPath, 'utf8'));
  sales.pilotSha256 = parcelSha256;
  writeFileSync(salesPath, `${JSON.stringify(sales, null, 2)}\n`);

  const descriptorPath = resolve(candidateRoot, 'release.json');
  const descriptor = JSON.parse(readFileSync(descriptorPath, 'utf8'));
  descriptor.sources.find((source: { kind: string }) => source.kind === 'parcels').period = published;
  descriptor.compatibility.salesRequiresParcelsSha256 = parcelSha256;
  for (const file of descriptor.files) {
    const bytes = readFileSync(resolve(candidateRoot, file.path));
    file.size = bytes.length;
    file.sha256 = createHash('sha256').update(bytes).digest('hex');
  }
  writeFileSync(descriptorPath, `${JSON.stringify(descriptor, null, 2)}\n`);
}

test('checked-in Bristol release descriptor binds every immutable component', () => {
  const release = releaseBundleSchema.parse(JSON.parse(readFileSync(resolve(pilotRoot, 'release.json'), 'utf8')));
  for (const file of release.files) {
    const path = resolve(pilotRoot, file.path);
    assert.equal(statSync(path).size, file.size);
    assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'), file.sha256);
  }

  const parcels = JSON.parse(readFileSync(resolve(pilotRoot, 'parcels.json'), 'utf8'));
  const basemap = JSON.parse(readFileSync(resolve(pilotRoot, 'basemap.json'), 'utf8'));
  const sales = JSON.parse(readFileSync(resolve(pilotRoot, 'sales.json'), 'utf8'));
  assert.equal(parcels.parcels.length, release.counts.parcels);
  assert.equal(basemap.features.length, release.counts.basemapFeatures);
  assert.equal(sales.records.length, release.counts.salesRecords);
  assert.equal(sales.pilotSha256, release.compatibility.salesRequiresParcelsSha256);
});

test('release descriptor rejects a parcel and sales compatibility mismatch', () => {
  const release = JSON.parse(readFileSync(resolve(pilotRoot, 'release.json'), 'utf8'));
  release.compatibility.salesRequiresParcelsSha256 = '0'.repeat(64);
  assert.throws(() => releaseBundleSchema.parse(release), /Sales compatibility must reference the release parcel hash/);
});

test('release store stages, activates, survives restart and rolls back', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'fieldwork-releases-'));
  const dataRoot = resolve(root, 'data');
  const runtimeLock = resolve(dataRoot, '.fieldwork-server.lock');
  try {
    const store = createReleaseStore({ root: dataRoot, runtimeLock });
    await store.stage(candidate(root, 'bristol-release-a'));
    const firstRelease = await store.activate('bristol-release-a');
    mkdirSync(resolve(dataRoot, '.release-staging-interrupted'));
    writeFileSync(resolve(dataRoot, '.release-staging-interrupted', 'partial.json'), '{}');
    assert.equal((await createReleaseStore({ root: dataRoot, runtimeLock }).active())?.descriptor.releaseId, 'bristol-release-a');

    const firstData = JSON.parse(readFileSync(resolve(firstRelease.path, 'parcels.json'), 'utf8'));
    const databasePath = resolve(dataRoot, 'cases.sqlite');
    let investigationStore = createInvestigationStore(databasePath);
    const investigation = investigationStore.create({ name: 'Release A case', question: '', notes: '' }, {
      dataset: 'pilot',
      releaseSha256: firstRelease.descriptor.files.find(file => file.path === 'parcels.json')!.sha256,
      parcel: firstData.parcels[0],
      manifest: firstData.manifest,
    });
    const originalSnapshot = JSON.stringify(investigation.snapshot);
    investigationStore.close();

    const secondCandidate = candidate(root, 'bristol-release-b');
    advanceParcelPeriod(secondCandidate, '2026-10-01');
    const secondRelease = await store.stage(secondCandidate);
    assert.equal(secondRelease.descriptor.sources.find(source => source.kind === 'parcels')?.period, '2026-10-01');
    await store.activate('bristol-release-b');
    assert.equal((await store.active())?.descriptor.releaseId, 'bristol-release-b');
    investigationStore = createInvestigationStore(databasePath);
    assert.equal(JSON.stringify(investigationStore.get(investigation.id)?.snapshot), originalSnapshot);
    investigationStore.close();
    assert.equal((await store.rollback()).descriptor.releaseId, 'bristol-release-a');
    assert.equal((await store.active())?.descriptor.releaseId, 'bristol-release-a');
    await assert.rejects(store.activate('bristol-release-a'), /already active/);

    const releaseLock = acquireRuntimeLock(runtimeLock);
    try { await assert.rejects(store.activate('bristol-release-b'), /server is running/); }
    finally { releaseLock(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('release store rejects hash, count and parcel-sales compatibility failures', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'fieldwork-invalid-releases-'));
  const dataRoot = resolve(root, 'data');
  const store = createReleaseStore({ root: dataRoot, runtimeLock: resolve(dataRoot, '.fieldwork-server.lock') });
  try {
    const badHash = candidate(root, 'bad-hash');
    writeFileSync(resolve(badHash, 'manifest.json'), `${readFileSync(resolve(badHash, 'manifest.json'), 'utf8')} `);
    await assert.rejects(store.stage(badHash), /file size does not match: manifest.json/);
    assert.equal(existsSync(resolve(dataRoot, 'releases', 'bad-hash')), false);

    const badCount = candidate(root, 'bad-count');
    const countDescriptorPath = resolve(badCount, 'release.json');
    const countDescriptor = JSON.parse(readFileSync(countDescriptorPath, 'utf8'));
    countDescriptor.counts.parcels++;
    writeFileSync(countDescriptorPath, `${JSON.stringify(countDescriptor, null, 2)}\n`);
    await assert.rejects(store.stage(badCount), /parcel count does not match/);

    const badSales = candidate(root, 'bad-sales');
    const salesPath = resolve(badSales, 'sales.json');
    const sales = JSON.parse(readFileSync(salesPath, 'utf8'));
    sales.pilotSha256 = '0'.repeat(64);
    writeFileSync(salesPath, `${JSON.stringify(sales, null, 2)}\n`);
    updateDescriptorFile(badSales, 'sales.json');
    await assert.rejects(store.stage(badSales), /Sales release does not match parcel geometry/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});