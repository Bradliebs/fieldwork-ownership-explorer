import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { strFromU8, strToU8, Unzip, UnzipInflate, Zip, ZipDeflate } from 'fflate';
import { z } from 'zod';
import { createInvestigationStore } from './investigation-store.ts';
import { checkInvestigationDatabase } from './investigation-migrations.ts';
import { acquireRuntimeLock, assertNoPendingRestore, restoreTransactionPrefix, runtimeLockName } from './runtime-lock.ts';
import { createStore, validateReviewJournal } from './store.ts';

const backupFormat = 'fieldwork-ownership-explorer-backup';
const managedFiles = ['investigations.sqlite', 'demo-reviews.jsonl'] as const;
const sqliteSidecars = ['investigations.sqlite-journal', 'investigations.sqlite-wal', 'investigations.sqlite-shm'] as const;
const replaceableFiles = [...managedFiles, ...sqliteSidecars] as const;
const archivePaths = ['data/investigations.sqlite', 'data/demo-reviews.jsonl'] as const;
const manifestPath = 'manifest.json';
const maxArchiveBytes = 9 * 1024 ** 3;
const maxManifestBytes = 64 * 1024;
const maxExpandedBytes: Record<typeof archivePaths[number], number> = {
  'data/investigations.sqlite': 8 * 1024 ** 3,
  'data/demo-reviews.jsonl': 256 * 1024 ** 2,
};
const maxCompressionRatio = 200;

const backupManifestPayloadSchema = z.object({
  format: z.literal(backupFormat),
  version: z.literal(1),
  createdAt: z.string().min(1),
  files: z.array(z.object({
    path: z.enum(archivePaths),
    size: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict()),
}).strict();
const backupManifestSchema = backupManifestPayloadSchema.extend({
  authentication: z.object({
    algorithm: z.literal('hmac-sha256'),
    value: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict(),
}).strict();
const restoreMarkerSchema = z.object({
  archivePath: z.string().min(1),
  safetyArchivePath: z.string().min(1),
  createdAt: z.string().min(1),
  originalFiles: z.array(z.enum(replaceableFiles)),
  state: z.enum(['replacing', 'committed']),
}).strict();

export type BackupManifest = z.infer<typeof backupManifestSchema>;
type BackupManifestPayload = z.infer<typeof backupManifestPayloadSchema>;

interface PreparedArchiveFile {
  path: typeof archivePaths[number];
  sourcePath: string;
  size: number;
  sha256: string;
}

interface ExtractedArchiveFile {
  size: number;
  sha256: string;
}

export interface RestoreResult {
  manifest: BackupManifest;
  safetyArchivePath: string;
}

export interface RecoveryResult {
  transactionPath: string;
  safetyArchivePath?: string;
  restoredOriginals: boolean;
}

function authenticationKey(key: string | Uint8Array): Uint8Array {
  const normalized = typeof key === 'string' ? Buffer.from(key, 'utf8') : key;
  if (normalized.byteLength < 32) throw new Error('Backup authentication key must be at least 32 bytes');
  return normalized;
}

function authenticateManifest(payload: BackupManifestPayload, key: string | Uint8Array): string {
  return createHmac('sha256', authenticationKey(key)).update(JSON.stringify(payload)).digest('hex');
}

function verifyManifestAuthentication(manifest: BackupManifest, key: string | Uint8Array): void {
  const { authentication, ...payload } = manifest;
  const expected = Buffer.from(authenticateManifest(payload, key), 'hex');
  const actual = Buffer.from(authentication.value, 'hex');
  if (!timingSafeEqual(actual, expected)) throw new Error('Backup authentication failed');
}

function archivePathFor(file: typeof managedFiles[number]): typeof archivePaths[number] {
  return `data/${file}`;
}

function samePath(left: string, right: string): boolean {
  const resolvedLeft = resolve(left);
  const resolvedRight = resolve(right);
  return process.platform === 'win32'
    ? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase()
    : resolvedLeft === resolvedRight;
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

async function writeRestoreMarker(path: string, marker: z.infer<typeof restoreMarkerSchema>): Promise<void> {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(marker, null, 2)}\n`, { flag: 'wx', flush: true });
    await renameWithRetry(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function snapshotDatabase(sourcePath: string, destinationPath: string): Promise<void> {
  const writable = new DatabaseSync(sourcePath);
  try {
    writable.exec('PRAGMA busy_timeout = 3000');
    checkInvestigationDatabase(writable);
    writable.prepare('PRAGMA wal_checkpoint(TRUNCATE)').all();
    checkInvestigationDatabase(writable);
  } finally {
    writable.close();
  }
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    checkInvestigationDatabase(source);
    source.prepare('VACUUM INTO ?').run(destinationPath);
  } finally {
    source.close();
  }
  const snapshot = createInvestigationStore(destinationPath);
  snapshot.close();
}

async function fileDigest(path: string): Promise<{ size: number; sha256: string }> {
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of createReadStream(path)) {
    size += chunk.byteLength;
    hash.update(chunk);
  }
  return { size, sha256: hash.digest('hex') };
}

async function archiveEntries(dataRoot: string, stagingRoot: string): Promise<PreparedArchiveFile[]> {
  const entries: PreparedArchiveFile[] = [];
  const databasePath = join(dataRoot, managedFiles[0]);
  if (existsSync(databasePath)) {
    const snapshotPath = join(stagingRoot, managedFiles[0]);
    await snapshotDatabase(databasePath, snapshotPath);
    entries.push({ path: archivePathFor(managedFiles[0]), sourcePath: snapshotPath, ...await fileDigest(snapshotPath) });
  }

  const journalPath = join(dataRoot, managedFiles[1]);
  if (existsSync(journalPath)) {
    await validateReviewJournal(journalPath);
    entries.push({ path: archivePathFor(managedFiles[1]), sourcePath: journalPath, ...await fileDigest(journalPath) });
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

async function writeArchive(path: string, manifest: BackupManifest, files: PreparedArchiveFile[]): Promise<void> {
  const output = createWriteStream(path, { flags: 'wx' });
  const drains: Promise<unknown>[] = [];
  let archiveError: Error | undefined;
  const completed = new Promise<void>((resolveComplete, rejectComplete) => {
    output.once('finish', resolveComplete);
    output.once('error', rejectComplete);
  });
  const archive = new Zip((error, chunk, final) => {
    if (error) {
      archiveError = error;
      output.destroy(error);
      return;
    }
    if (chunk.byteLength && !output.write(chunk)) drains.push(once(output, 'drain'));
    if (final) output.end();
  });
  async function waitForOutput(): Promise<void> {
    const pending = drains.splice(0);
    if (pending.length) await Promise.all(pending);
    if (archiveError) throw archiveError;
  }
  async function addContent(name: string, chunks: AsyncIterable<Uint8Array> | Uint8Array): Promise<void> {
    const entry = new ZipDeflate(name, { level: 6 });
    archive.add(entry);
    if (Symbol.asyncIterator in Object(chunks)) {
      for await (const chunk of chunks as AsyncIterable<Uint8Array>) {
        entry.push(chunk);
        await waitForOutput();
      }
      entry.push(new Uint8Array(), true);
    } else {
      entry.push(chunks as Uint8Array, true);
    }
    await waitForOutput();
  }

  try {
    await addContent(manifestPath, strToU8(`${JSON.stringify(manifest, null, 2)}\n`));
    for (const file of files) await addContent(file.path, createReadStream(file.sourcePath));
    archive.end();
    await completed;
  } catch (error) {
    archive.terminate();
    output.destroy();
    throw error;
  }
}

async function createDataBackupUnlocked(dataRoot: string, archivePath: string, key: string | Uint8Array): Promise<BackupManifest> {
  const root = resolve(dataRoot);
  const destination = resolve(archivePath);
  if (replaceableFiles.some(file => samePath(join(root, file), destination))) {
    throw new Error('Backup archive cannot replace a managed data file or SQLite sidecar');
  }
  if (existsSync(destination)) throw new Error('Backup archive already exists');

  const stagingRoot = await mkdtemp(join(tmpdir(), 'fieldwork-backup-'));
  const temporaryArchive = `${destination}.${randomUUID()}.tmp`;
  try {
    const entries = await archiveEntries(root, stagingRoot);
    const payload = backupManifestPayloadSchema.parse({
      format: backupFormat,
      version: 1,
      createdAt: new Date().toISOString(),
      files: entries.map(({ path, size, sha256: checksum }) => ({ path, size, sha256: checksum })),
    });
    const manifest = backupManifestSchema.parse({
      ...payload,
      authentication: { algorithm: 'hmac-sha256', value: authenticateManifest(payload, key) },
    });
    await mkdir(dirname(destination), { recursive: true });
    await writeArchive(temporaryArchive, manifest, entries);
    await renameWithRetry(temporaryArchive, destination);
    return manifest;
  } finally {
    await rm(temporaryArchive, { force: true });
    await rm(stagingRoot, { recursive: true, force: true });
  }
}

export async function createDataBackup(dataRoot: string, archivePath: string, key: string | Uint8Array): Promise<BackupManifest> {
  const root = resolve(dataRoot);
  const releaseRuntimeLock = acquireRuntimeLock(join(root, runtimeLockName));
  try {
    assertNoPendingRestore(root);
    return await createDataBackupUnlocked(root, archivePath, key);
  } finally {
    releaseRuntimeLock();
  }
}

function readManifest(content: Uint8Array, key: string | Uint8Array): BackupManifest {
  let manifest: BackupManifest;
  try {
    manifest = backupManifestSchema.parse(JSON.parse(strFromU8(content)));
  } catch (error) {
    throw new Error('Backup manifest is invalid', { cause: error });
  }
  verifyManifestAuthentication(manifest, key);
  return manifest;
}

async function extractArchive(archivePath: string, stagingRoot: string, key: string | Uint8Array): Promise<BackupManifest> {
  const archiveSize = (await stat(resolve(archivePath))).size;
  if (archiveSize <= 0 || archiveSize > maxArchiveBytes) throw new Error('Backup archive size is outside the supported limit');

  const seen = new Set<string>();
  const extracted = new Map<string, ExtractedArchiveFile>();
  const writers: ReturnType<typeof createWriteStream>[] = [];
  const writes: Promise<void>[] = [];
  const drains: Promise<unknown>[] = [];
  let manifest: BackupManifest | undefined;
  let expandedBytes = 0;
  let archiveError: Error | undefined;
  function fail(error: unknown): void {
    archiveError ??= error instanceof Error ? error : new Error(String(error));
  }

  const archive = new Unzip(file => {
    try {
      if (seen.has(file.name)) throw new Error('Backup archive contains duplicate entries');
      if (seen.size === 0 && file.name !== manifestPath) throw new Error('Backup manifest must be the first archive entry');
      if (seen.size >= archivePaths.length + 1) throw new Error('Backup archive contains too many entries');
      seen.add(file.name);

      if (file.name === manifestPath) {
        const chunks: Buffer[] = [];
        let size = 0;
        file.ondata = (error, chunk, final) => {
          if (error) { fail(error); return; }
          size += chunk.byteLength;
          expandedBytes += chunk.byteLength;
          if (size > maxManifestBytes) { fail(new Error('Backup manifest exceeds the supported limit')); file.terminate(); return; }
          chunks.push(Buffer.from(chunk));
          if (final) {
            try { manifest = readManifest(Buffer.concat(chunks, size), key); }
            catch (manifestError) { fail(manifestError); }
          }
        };
        file.start();
        return;
      }

      if (!manifest) throw new Error('Backup manifest authentication must complete before data entries');
      if (!archivePaths.includes(file.name as typeof archivePaths[number]) || !manifest.files.some(item => item.path === file.name)) {
        throw new Error('Backup archive contents do not match its manifest');
      }
      const entryPath = file.name as typeof archivePaths[number];
      const limit = maxExpandedBytes[entryPath];
      if (file.originalSize !== undefined && file.originalSize > limit) throw new Error(`Backup entry exceeds the supported limit: ${entryPath}`);
      if (file.size && file.originalSize && file.originalSize / file.size > maxCompressionRatio) {
        throw new Error(`Backup entry compression ratio is unsafe: ${entryPath}`);
      }

      const output = createWriteStream(join(stagingRoot, entryPath), { flags: 'wx' });
      writers.push(output);
      writes.push(new Promise(resolveWrite => {
        output.once('finish', resolveWrite);
        output.once('error', error => { fail(error); resolveWrite(); });
      }));
      const hash = createHash('sha256');
      let size = 0;
      file.ondata = (error, chunk, final) => {
        if (error) { fail(error); output.destroy(); return; }
        size += chunk.byteLength;
        expandedBytes += chunk.byteLength;
        if (size > limit || expandedBytes > archiveSize * maxCompressionRatio + maxManifestBytes) {
          fail(new Error(`Backup entry exceeds safe expansion limits: ${entryPath}`));
          file.terminate();
          output.destroy();
          return;
        }
        hash.update(chunk);
        if (chunk.byteLength && !output.write(chunk) && !final) drains.push(once(output, 'drain'));
        if (final) {
          extracted.set(entryPath, { size, sha256: hash.digest('hex') });
          output.end();
        }
      };
      file.start();
    } catch (error) {
      fail(error);
      file.terminate();
    }
  });
  archive.register(UnzipInflate);

  try {
    for await (const chunk of createReadStream(resolve(archivePath))) {
      archive.push(chunk);
      const pending = drains.splice(0);
      if (pending.length) await Promise.all(pending);
      if (archiveError) throw archiveError;
    }
    archive.push(new Uint8Array(), true);
    const pending = drains.splice(0);
    if (pending.length) await Promise.all(pending);
    await Promise.all(writes);
    if (archiveError) throw archiveError;
  } catch (error) {
    for (const writer of writers) writer.destroy();
    throw error;
  }

  if (!manifest) throw new Error('Backup manifest is missing');
  const listedPaths = manifest.files.map(file => file.path);
  if (new Set(listedPaths).size !== listedPaths.length) throw new Error('Backup manifest contains duplicate files');
  const actualPaths = [...extracted.keys()].sort();
  if (JSON.stringify(actualPaths) !== JSON.stringify([...listedPaths].sort())) {
    throw new Error('Backup archive contents do not match its manifest');
  }
  for (const file of manifest.files) {
    const actual = extracted.get(file.path);
    if (!actual || actual.size !== file.size || actual.sha256 !== file.sha256) {
      throw new Error(`Backup file verification failed: ${file.path}`);
    }
  }
  return manifest;
}

async function stageDataBackup(archivePath: string, stagingRoot: string, key: string | Uint8Array): Promise<BackupManifest> {
  const stagedDataRoot = join(stagingRoot, 'data');
  await mkdir(stagedDataRoot, { recursive: true });
  const manifest = await extractArchive(archivePath, stagingRoot, key);

  const stagedDatabase = join(stagedDataRoot, managedFiles[0]);
  if (existsSync(stagedDatabase)) {
    const store = createInvestigationStore(stagedDatabase);
    store.close();
  }
  const stagedJournal = join(stagedDataRoot, managedFiles[1]);
  if (existsSync(stagedJournal)) await validateReviewJournal(stagedJournal);
  return manifest;
}

export async function verifyDataBackup(archivePath: string, key: string | Uint8Array): Promise<BackupManifest> {
  const stagingRoot = await mkdtemp(join(tmpdir(), 'fieldwork-verify-'));
  try {
    return await stageDataBackup(archivePath, stagingRoot, key);
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}

export async function restoreDataBackup(
  dataRoot: string,
  archivePath: string,
  key: string | Uint8Array,
  safetyArchivePath?: string,
): Promise<RestoreResult> {
  const root = resolve(dataRoot);
  await mkdir(root, { recursive: true });
  const releaseRuntimeLock = acquireRuntimeLock(join(root, runtimeLockName));
  const transactionRoot = join(root, `${restoreTransactionPrefix}${randomUUID()}`);
  const stagingRoot = join(transactionRoot, 'incoming');
  const rollbackRoot = join(transactionRoot, 'original');
  const markerPath = join(transactionRoot, 'restore.json');
  const safetyPath = resolve(safetyArchivePath ?? join(dirname(resolve(archivePath)),
    `fieldwork-pre-restore-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.zip`));
  let replacementStarted = false;
  let preserveTransaction = false;
  try {
    assertNoPendingRestore(root);
    await mkdir(stagingRoot, { recursive: true });
    const manifest = await stageDataBackup(archivePath, stagingRoot, key);
    await createDataBackupUnlocked(root, safetyPath, key);
    await mkdir(rollbackRoot, { recursive: true });
    const originalFiles = replaceableFiles.filter(file => existsSync(join(root, file)));
    const restoreMarker: z.infer<typeof restoreMarkerSchema> = {
      archivePath: resolve(archivePath),
      safetyArchivePath: safetyPath,
      createdAt: new Date().toISOString(),
      originalFiles,
      state: 'replacing',
    };
    await writeRestoreMarker(markerPath, restoreMarker);
    replacementStarted = true;
    const movedOriginals: string[] = [];
    const installedFiles: string[] = [];
    try {
      for (const file of replaceableFiles) {
        const currentPath = join(root, file);
        if (existsSync(currentPath)) {
          await renameWithRetry(currentPath, join(rollbackRoot, file));
          movedOriginals.push(file);
        }
      }
      for (const file of manifest.files) {
        const name = basename(file.path) as typeof managedFiles[number];
        await renameWithRetry(join(stagingRoot, file.path), join(root, name));
        installedFiles.push(name);
      }
      const restoredDatabase = join(root, managedFiles[0]);
      if (existsSync(restoredDatabase)) {
        const store = createInvestigationStore(restoredDatabase);
        store.close();
      }
      const restoredJournal = join(root, managedFiles[1]);
      if (existsSync(restoredJournal)) await validateReviewJournal(restoredJournal);
      await writeRestoreMarker(markerPath, { ...restoreMarker, state: 'committed' });
    } catch (error) {
      try {
        for (const file of replaceableFiles) {
          const originalRemainsInPlace = originalFiles.includes(file) && !movedOriginals.includes(file);
          if (!originalRemainsInPlace) {
            await rm(join(root, file), { force: true });
          }
        }
        for (const file of movedOriginals) await renameWithRetry(join(rollbackRoot, file), join(root, file));
      } catch (rollbackError) {
        preserveTransaction = true;
        throw new AggregateError([error, rollbackError], `Restore failed and rollback is incomplete; recover from ${transactionRoot}`);
      }
      throw error;
    }
    await rm(transactionRoot, { recursive: true, force: true });
    return { manifest, safetyArchivePath: safetyPath };
  } finally {
    try {
      if (!preserveTransaction && existsSync(transactionRoot)) {
        await rm(transactionRoot, { recursive: true, force: !replacementStarted });
      }
    } finally {
      releaseRuntimeLock();
    }
  }
}

export async function recoverPendingRestore(dataRoot: string): Promise<RecoveryResult> {
  const root = resolve(dataRoot);
  await mkdir(root, { recursive: true });
  const releaseRuntimeLock = acquireRuntimeLock(join(root, runtimeLockName));
  try {
    const pending = (await readdir(root, { withFileTypes: true }))
      .filter(entry => entry.isDirectory() && entry.name.startsWith(restoreTransactionPrefix));
    if (pending.length === 0) throw new Error('No incomplete data restore was found');
    if (pending.length !== 1) throw new Error('Multiple incomplete data restores require manual recovery');

    const transactionPath = join(root, pending[0].name);
    const markerPath = join(transactionPath, 'restore.json');
    if (!existsSync(markerPath)) {
      await rm(transactionPath, { recursive: true, force: true });
      return { transactionPath, restoredOriginals: false };
    }

    let marker: z.infer<typeof restoreMarkerSchema>;
    try {
      marker = restoreMarkerSchema.parse(JSON.parse(await readFile(markerPath, 'utf8')));
    } catch (error) {
      throw new Error(`Incomplete restore marker is invalid: ${markerPath}`, { cause: error });
    }
    if (marker.state === 'committed') {
      await rm(transactionPath, { recursive: true, force: true });
      return { transactionPath, safetyArchivePath: marker.safetyArchivePath, restoredOriginals: false };
    }
    const rollbackRoot = join(transactionPath, 'original');
    for (const file of replaceableFiles) {
      const currentPath = join(root, file);
      const originalPath = join(rollbackRoot, file);
      if (marker.originalFiles.includes(file)) {
        if (existsSync(originalPath)) {
          await rm(currentPath, { force: true });
          await renameWithRetry(originalPath, currentPath);
        } else if (!existsSync(currentPath)) {
          throw new Error(`Incomplete restore is missing original file: ${file}`);
        }
      } else {
        await rm(currentPath, { force: true });
      }
    }

    const databasePath = join(root, managedFiles[0]);
    if (existsSync(databasePath)) {
      const store = createInvestigationStore(databasePath);
      store.close();
    }
    const journalPath = join(root, managedFiles[1]);
    if (existsSync(journalPath)) await validateReviewJournal(journalPath);
    await rm(transactionPath, { recursive: true, force: true });
    return { transactionPath, safetyArchivePath: marker.safetyArchivePath, restoredOriginals: true };
  } finally {
    releaseRuntimeLock();
  }
}