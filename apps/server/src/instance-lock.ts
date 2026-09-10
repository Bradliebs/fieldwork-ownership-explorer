import { randomUUID } from 'node:crypto';
import { existsSync, linkSync, mkdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';

const instanceLockSchema = z.object({
  id: z.string().uuid(),
  pid: z.number().int().positive(),
  startedAt: z.string().datetime({ offset: true }),
  url: z.string().url(),
}).strict();

export type InstanceLockResult =
  | { acquired: true; id: string; release: () => void }
  | { acquired: false; pid: number; url: string };

function readInstance(path: string) {
  try { return instanceLockSchema.parse(JSON.parse(readFileSync(path, 'utf8'))); }
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

export function acquireInstanceLock(path: string, url: string): InstanceLockResult {
  mkdirSync(dirname(path), { recursive: true });
  const lock = instanceLockSchema.parse({ id: randomUUID(), pid: process.pid, startedAt: new Date().toISOString(), url });
  const temporaryPath = `${path}.${lock.id}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(lock)}\n`, { flag: 'wx', flush: true });
  try {
    for (;;) {
      try {
        linkSync(temporaryPath, path);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const existing = readInstance(path);
        if (!existing) throw new Error(`An invalid runtime lock exists at ${path}; remove it only after confirming that no Fieldwork process is running`);
        if (processIsRunning(existing.pid)) return { acquired: false, pid: existing.pid, url: existing.url };

        const recoveredPath = `${path}.stale-${existing.id}`;
        try { renameSync(path, recoveredPath); }
        catch (renameError) {
          if (['ENOENT', 'EACCES', 'EBUSY', 'EPERM'].includes((renameError as NodeJS.ErrnoException).code ?? '')) continue;
          throw renameError;
        }
        const recovered = readInstance(recoveredPath);
        if (recovered?.id !== existing.id) {
          if (!existsSync(path)) renameSync(recoveredPath, path);
          throw new Error('Runtime lock changed during stale-lock recovery');
        }
        rmSync(recoveredPath, { force: true });
      }
    }
  } finally {
    try { unlinkSync(temporaryPath); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }

  let released = false;
  return { acquired: true, id: lock.id, release: () => {
    if (released) return;
    released = true;
    if (readInstance(path)?.id !== lock.id) return;
    try { unlinkSync(path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  } };
}