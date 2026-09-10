import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createDataBackup, recoverPendingRestore, restoreDataBackup, verifyDataBackup } from './backup.ts';
import { resolveRuntimeConfig } from './config.ts';
import { backupStatus } from './diagnostics.ts';

function defaultArchivePath(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return join(process.cwd(), 'backups', `fieldwork-${timestamp}.zip`);
}

function requiredArchivePath(value: string | undefined, command: string): string {
  if (!value?.trim()) throw new Error(`${command} requires an archive path`);
  return resolve(value);
}

function requiredAuthenticationKey(): string {
  const keyFile = process.env.FIELDWORK_BACKUP_KEY_FILE?.trim();
  if (keyFile && process.env.FIELDWORK_BACKUP_KEY) {
    throw new Error('Set only one of FIELDWORK_BACKUP_KEY or FIELDWORK_BACKUP_KEY_FILE');
  }
  const key = keyFile ? readFileSync(resolve(keyFile), 'utf8').trim() : process.env.FIELDWORK_BACKUP_KEY;
  if (!key || Buffer.byteLength(key, 'utf8') < 32) {
    throw new Error('Backup authentication key must contain at least 32 bytes');
  }
  return key;
}

async function main(): Promise<void> {
  const [command, archiveArgument, safetyArgument] = process.argv.slice(2);
  const config = resolveRuntimeConfig();
  if (command === 'backup') {
    const key = requiredAuthenticationKey();
    const archivePath = resolve(archiveArgument?.trim() || defaultArchivePath());
    const manifest = await createDataBackup(config.dataRoot, archivePath, key);
    backupStatus(config.dataRoot, archivePath, 'created');
    console.log(JSON.stringify({ operation: 'backup', archivePath, manifest }, null, 2));
    return;
  }
  if (command === 'verify') {
    const archivePath = requiredArchivePath(archiveArgument, 'verify');
    const key = requiredAuthenticationKey();
    const manifest = await verifyDataBackup(archivePath, key);
    backupStatus(config.dataRoot, archivePath, 'verified');
    console.log(JSON.stringify({ operation: 'verify', archivePath, manifest }, null, 2));
    return;
  }
  if (command === 'restore') {
    const archivePath = requiredArchivePath(archiveArgument, 'restore');
    const key = requiredAuthenticationKey();
    const result = await restoreDataBackup(config.dataRoot, archivePath, key, safetyArgument ? resolve(safetyArgument) : undefined);
    console.log(JSON.stringify({ operation: 'restore', archivePath, ...result }, null, 2));
    return;
  }
  if (command === 'recover') {
    const result = await recoverPendingRestore(config.dataRoot);
    console.log(JSON.stringify({ operation: 'recover', ...result }, null, 2));
    return;
  }
  throw new Error('Usage: backup-cli.ts <backup [archive] | verify <archive> | restore <archive> [safety-archive] | recover>');
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});