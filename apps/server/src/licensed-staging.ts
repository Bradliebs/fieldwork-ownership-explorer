import { constants, mkdirSync, openSync, closeSync, readSync, realpathSync, existsSync, writeFileSync, unlinkSync, fsyncSync, renameSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { strToU8, zipSync, unzipSync } from 'fflate';
import { licensedProviderSchema, providerReadiness } from '../../../packages/contracts/src/licensed-provider.ts';
import { ownershipMappingSchema, prepareOwnershipImport } from './licensed-import.ts';

export function readBoundedFile(path: string, limit: number): Buffer {
  const descriptor = openSync(path, constants.O_RDONLY);
  try {
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const bytes = readSync(descriptor, buffer, length, buffer.length - length, null);
      if (!bytes) break;
      length += bytes;
    }
    if (!length || length > limit) throw new Error('Input file is empty or exceeds its size limit');
    return buffer.subarray(0, length);
  } finally { closeSync(descriptor); }
}

function canonicalPath(path: string): string {
  const full = resolve(path);
  if (existsSync(full)) return realpathSync(full);
  return join(canonicalPath(dirname(full)), relative(dirname(full), full));
}

function inside(parent: string, child: string): boolean {
  const difference = relative(parent, child);
  return difference === '' || (!isAbsolute(difference) && difference !== '..' && !difference.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`));
}

export function stageLicensedOwnership(options: { profilePath: string; mappingPath: string; csvPath: string; dataRoot: string; assetRoot: string; workingDirectory?: string; today?: string }) {
  const workingDirectory = resolve(options.workingDirectory ?? process.cwd());
  const root = canonicalPath(join(options.dataRoot, 'licensed-staging'));
  const forbidden = [options.assetRoot, ...['public', 'dist', 'build', '.git', 'node_modules'].map(folder => join(workingDirectory, folder))].map(canonicalPath);
  if (forbidden.some(path => inside(path, root))) throw new Error('Licensed staging must be outside public, build, repository metadata and dependency directories');
  const profile = licensedProviderSchema.parse(JSON.parse(readBoundedFile(options.profilePath, 64_000).toString('utf8')));
  const mapping = ownershipMappingSchema.parse(JSON.parse(readBoundedFile(options.mappingPath, 16_000).toString('utf8')));
  const source = readBoundedFile(options.csvPath, 10_000_000);
  const prepared = prepareOwnershipImport(source, profile, mapping, options.today);
  const { records, ...provenance } = prepared;
  const candidateBytes = strToU8(JSON.stringify(records));
  const archive = zipSync({
    'source.csv': source,
    'candidates.json': candidateBytes,
    'manifest.json': strToU8(JSON.stringify({ ...provenance, stagedAt: new Date().toISOString(), recordCount: records.length,
      candidatesSha256: createHash('sha256').update(candidateBytes).digest('hex') }, null, 2)),
  });
  mkdirSync(root, { recursive: true, mode: 0o700 });
  if (canonicalPath(root) !== root) throw new Error('Licensed staging location changed during preparation');
  const id = randomUUID();
  const path = join(root, `${id}.zip`);
  const pending = `${path}.partial`;
  const descriptor = openSync(pending, 'wx', 0o600);
  try { writeFileSync(descriptor, archive); fsyncSync(descriptor); }
  catch (error) { closeSync(descriptor); unlinkSync(pending); throw error; }
  closeSync(descriptor);
  try { renameSync(pending, path); }
  catch (error) { unlinkSync(pending); throw error; }
  return { id, path, records: records.length, sourceSha256: prepared.sourceSha256,
    archiveSha256: createHash('sha256').update(archive).digest('hex'), caseChanges: 0, networkRequests: 0 };
}

export function verifyLicensedArchive(path: string, today = new Date().toISOString().slice(0, 10)) {
  const archive = readBoundedFile(path, 40_000_000);
  const seen = new Set<string>();
  const limits: Record<string, number> = { 'source.csv': 10_000_000, 'manifest.json': 100_000, 'candidates.json': 30_000_000 };
  const files = unzipSync(archive, { filter: file => {
    if (!Object.hasOwn(limits, file.name) || seen.has(file.name) || file.originalSize > limits[file.name]) throw new Error('Unexpected, duplicated or oversized staging entry');
    seen.add(file.name);
    return true;
  } });
  if (seen.size !== 3) throw new Error('Incomplete licensed staging archive');
  const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(files['manifest.json']));
  if (manifest.schemaVersion !== 1 || manifest.kind !== 'licensed-ownership-staging' || typeof manifest.preparedOn !== 'string') throw new Error('Unknown licensed staging format');
  if (manifest.preparedOn > today) throw new Error('Staging date is in the future');
  const original = prepareOwnershipImport(Buffer.from(files['source.csv']), manifest.provider, manifest.mapping, manifest.preparedOn);
  for (const field of ['sourceSha256', 'profileSha256', 'mappingSha256'] as const) {
    if (manifest[field] !== original[field]) throw new Error('Staging provenance checksum mismatch');
  }
  const candidateHash = createHash('sha256').update(files['candidates.json']).digest('hex');
  if (manifest.candidatesSha256 !== candidateHash || manifest.recordCount !== original.records.length ||
    Buffer.from(files['candidates.json']).toString('utf8') !== JSON.stringify(original.records)) throw new Error('Staged candidate records do not match source and mapping');
  const readiness = providerReadiness(original.provider, today);
  return { records: original.records.length, sourceSha256: original.sourceSha256,
    archiveSha256: createHash('sha256').update(archive).digest('hex'), integrity: 'verified' as const,
    licenceCurrentlyReady: readiness.ready, blockers: readiness.blockers,
    authenticity: 'not-established' as const, caseChanges: 0 };
}