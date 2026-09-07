import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import type { SalesRelease } from '../../../packages/contracts/src/sales.ts';

export function readPilotSales(pilotPath: string): SalesRelease | undefined {
  const path = join(dirname(pilotPath), 'sales.json');
  if (!existsSync(path)) return undefined;
  const release = JSON.parse(readFileSync(path, 'utf8')) as SalesRelease;
  if (!Array.isArray(release.records) || release.pilotSha256 !== createHash('sha256').update(readFileSync(pilotPath)).digest('hex')) {
    throw new Error('Sales release does not match pilot geometry');
  }
  return release;
}