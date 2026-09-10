import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';

const logEntrySchema = z.object({
  at: z.string().datetime({ offset: true }),
  event: z.literal('request'),
  requestId: z.string().min(1).max(100),
  route: z.string().min(1).max(200),
  status: z.number().int().min(100).max(599),
  durationMs: z.number().nonnegative(),
  releaseId: z.string().min(1).max(200),
  applicationVersion: z.string().min(1).max(50),
  schemaVersion: z.number().int().nonnegative(),
  errorCode: z.string().min(1).max(80).nullable(),
}).strict();

export type OperationalLogEntry = z.infer<typeof logEntrySchema>;

function wait(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function renameWithRetry(source: string, destination: string): void {
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(source, destination);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 4 || !['EACCES', 'EBUSY', 'EPERM'].includes(code ?? '')) throw error;
      wait(25 * (attempt + 1));
    }
  }
}

function readLogFile(path: string): OperationalLogEntry[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean).flatMap(line => {
    try { return [logEntrySchema.parse(JSON.parse(line))]; }
    catch { return []; }
  });
}

export function createOperationalLog(path: string, maxBytes = 1024 * 1024) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024) throw new Error('Operational log limit must be at least 1024 bytes');
  mkdirSync(dirname(path), { recursive: true });
  return {
    path,
    write(value: OperationalLogEntry): void {
      const entry = logEntrySchema.parse(value);
      const line = `${JSON.stringify(entry)}\n`;
      if (existsSync(path) && statSync(path).size + Buffer.byteLength(line) > maxBytes) {
        rmSync(`${path}.1`, { force: true });
        renameWithRetry(path, `${path}.1`);
      }
      appendFileSync(path, line, { encoding: 'utf8', flush: true });
    },
    read(): OperationalLogEntry[] {
      return [...readLogFile(`${path}.1`), ...readLogFile(path)];
    },
  };
}