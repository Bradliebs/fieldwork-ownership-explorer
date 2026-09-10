import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statfsSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { checkInvestigationDatabase, investigationSchemaVersion } from './investigation-migrations.ts';
import type { OperationalLogEntry } from './operational-log.ts';

export const applicationVersion = '0.1.0';

const backupStatusSchema = z.object({
  operation: z.enum(['created', 'verified']),
  completedAt: z.string().datetime({ offset: true }),
  archiveName: z.string().min(1).max(260),
}).strict();

export interface DiagnosticOptions {
  dataRoot?: string;
  investigationDb?: string;
  releaseId?: string;
  logPath?: string;
}

function storageFacts(dataRoot: string | undefined) {
  if (!dataRoot) return { writable: false, freeBytes: null };
  mkdirSync(dataRoot, { recursive: true });
  const probe = join(dataRoot, `.diagnostic-${randomUUID()}.tmp`);
  let writable = false;
  try {
    writeFileSync(probe, '', { flag: 'wx', flush: true });
    writable = true;
  } finally { rmSync(probe, { force: true }); }
  const fileSystem = statfsSync(dataRoot, { bigint: true });
  const freeBytes = fileSystem.bavail * fileSystem.bsize;
  return { writable, freeBytes: freeBytes > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(freeBytes) };
}

function databaseFacts(path: string | undefined) {
  if (!path || !existsSync(path)) return { integrity: 'unavailable' as const };
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    checkInvestigationDatabase(database);
    return { integrity: 'ok' as const };
  } catch {
    return { integrity: 'failed' as const };
  } finally { database.close(); }
}

function backupFacts(dataRoot: string | undefined) {
  if (!dataRoot) return null;
  try { return backupStatusSchema.parse(JSON.parse(readFileSync(join(dataRoot, 'backup-status.json'), 'utf8'))); }
  catch { return null; }
}

export function diagnostics(options: DiagnosticOptions) {
  return {
    applicationVersion,
    schemaVersion: investigationSchemaVersion,
    releaseId: options.releaseId ?? 'development',
    storage: storageFacts(options.dataRoot),
    database: databaseFacts(options.investigationDb),
    lastBackup: backupFacts(options.dataRoot),
    log: { path: options.logPath ?? null },
  };
}

export function backupStatus(dataRoot: string, archivePath: string, operation: 'created' | 'verified') {
  const status = backupStatusSchema.parse({ operation, completedAt: new Date().toISOString(), archiveName: basename(archivePath) });
  writeFileSync(join(dataRoot, 'backup-status.json'), `${JSON.stringify(status, null, 2)}\n`, { flush: true });
  return status;
}

export function diagnosticExport(options: DiagnosticOptions, logs: OperationalLogEntry[]) {
  return { generatedAt: new Date().toISOString(), diagnostics: diagnostics(options), logs };
}