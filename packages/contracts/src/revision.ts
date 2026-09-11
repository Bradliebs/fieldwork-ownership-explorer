import type { Investigation } from './investigation.ts';

export interface RevisionChange {
  path: string;
  before: unknown;
  after: unknown;
}

export function compareRevisions(before: Investigation | null, after: Investigation): RevisionChange[] {
  const changes: RevisionChange[] = [];
  function compare(previous: unknown, current: unknown, path: string) {
    if (Object.is(previous, current)) return;
    if (Array.isArray(previous) && Array.isArray(current)) {
      const records = [...previous, ...current];
      if (records.every(record => record && typeof record === 'object' && typeof record.id === 'string')) {
        const ids = [...new Set(records.map(record => String(record.id)))];
        for (const id of ids) compare(previous.find(record => record.id === id), current.find(record => record.id === id), `${path}[${id}]`);
        return;
      }
      if (JSON.stringify(previous) === JSON.stringify(current)) return;
    } else if (previous && current && typeof previous === 'object' && typeof current === 'object' && !Array.isArray(previous) && !Array.isArray(current)) {
      const previousFields = previous as Record<string, unknown>;
      const currentFields = current as Record<string, unknown>;
      for (const key of [...new Set([...Object.keys(previousFields), ...Object.keys(currentFields)])].sort()) compare(previousFields[key], currentFields[key], `${path}.${key}`);
      return;
    }
    changes.push({ path, before: previous, after: current });
  }
  for (const field of ['name', 'question', 'notes', 'workflow', 'documents'] as const) compare(before?.[field], after[field], field);
  return changes;
}