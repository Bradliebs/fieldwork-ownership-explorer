import { randomUUID } from 'node:crypto';
import { existsSync, linkSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';

export const runtimeLockName = '.fieldwork-server.lock';
export const restoreTransactionPrefix = '.fieldwork-restore-';

const runtimeLockSchema = z.object({
  id: z.string().uuid(),
  pid: z.number().int().positive(),
  startedAt: z.string().min(1),
  url: z.string().url().optional(),
}).strict();

function readRuntimeLock(path: string) {
  try { return runtimeLockSchema.parse(JSON.parse(readFileSync(path, 'utf8'))); }
  catch { return undefined; }
}

function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

export function assertRuntimeStopped(path: string): void {
  if (!existsSync(path)) return;
  const lock = readRuntimeLock(path);
  if (lock && processIsRunning(lock.pid)) {
    throw new Error(`Fieldwork server is running with PID ${lock.pid}; stop it before managing backups`);
  }
  throw new Error(`A stale or invalid runtime lock exists at ${path}; remove it only after confirming that no Fieldwork process is running`);
}

export function acquireRuntimeLock(path: string): () => void {
  mkdirSync(dirname(path), { recursive: true });
  const lock = { id: randomUUID(), pid: process.pid, startedAt: new Date().toISOString() };
  const temporaryPath = `${path}.${lock.id}.tmp`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(lock)}\n`, { flag: 'wx', flush: true });
    for (;;) {
      try {
        linkSync(temporaryPath, path);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        assertRuntimeStopped(path);
      }
    }
  } finally {
    try { unlinkSync(temporaryPath); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (readRuntimeLock(path)?.id !== lock.id) return;
    try { unlinkSync(path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  };
}

export function assertNoPendingRestore(dataRoot: string): void {
  const pending = existsSync(dataRoot)
    ? readdirSync(dataRoot).find(name => name.startsWith(restoreTransactionPrefix))
    : undefined;
  if (pending) throw new Error(`Incomplete data restore requires recovery: ${pending}`);
}