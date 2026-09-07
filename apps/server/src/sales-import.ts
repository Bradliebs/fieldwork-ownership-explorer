import { parse } from 'csv-parse/sync';
import type { SaleRecord } from '../../../packages/contracts/src/sales.ts';

function transactionId(value: string): string {
  if (!/^\{[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\}$/i.test(value)) throw new Error('Invalid transaction identifier');
  return value.toUpperCase();
}

export function joinSales(lookupCsv: string, priceCsv: string, pilotIds: Set<string>): SaleRecord[] {
  const lookup = parse(lookupCsv, { bom: true, skip_empty_lines: true }) as string[][];
  const polygons = new Map<string, Set<string>>();
  for (const row of lookup) {
    if (row.length !== 2 || !/^\d{1,9}$/.test(row[1])) throw new Error('Invalid INSPIRE lookup row');
    const id = transactionId(row[0]);
    const ids = polygons.get(id) ?? new Set<string>();
    ids.add(row[1]); polygons.set(id, ids);
  }
  const relevant = new Set([...polygons].filter(([, ids]) => [...ids].some(id => pilotIds.has(id))).map(([id]) => id));
  const records = new Map<string, SaleRecord>();
  const seen = new Set<string>();
  for (const row of parse(priceCsv, { bom: true, skip_empty_lines: true }) as string[][]) {
    if (row.length !== 16) throw new Error('Expected 16 Price Paid columns including record status');
    const id = transactionId(row[0]);
    if (!relevant.has(id)) continue;
    if (seen.has(id)) throw new Error('Duplicate Price Paid transaction in monthly release');
    seen.add(id);
    if (!['A', 'C', 'D'].includes(row[15])) throw new Error('Invalid Price Paid record status');
    if (row[15] === 'D') continue;
    if (!/^\d+$/.test(row[1]) || !Number.isSafeInteger(Number(row[1])) || Number(row[1]) <= 0) throw new Error('Invalid sale price');
    const date = row[2].slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2} 00:00$/.test(row[2]) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('Invalid sale date');
    if (row[6] !== 'F') throw new Error('INSPIRE-linked sale is not freehold');
    if (!['D', 'S', 'T', 'F', 'O'].includes(row[4]) || !['Y', 'N'].includes(row[5]) || !['A', 'B'].includes(row[14])) throw new Error('Invalid sale classification');
    records.set(id, {
      transactionId: id, inspireIds: [...polygons.get(id)!].sort(), price: Number(row[1]), date,
      address: [row[8], row[7], row[9], row[10], row[11], row[3]].filter(Boolean).join(', '),
      propertyType: ({ D: 'Detached', S: 'Semi-detached', T: 'Terraced', F: 'Flat / maisonette', O: 'Other' } as Record<string, string>)[row[4]],
      newBuild: row[5] === 'Y', category: row[14] === 'A' ? 'Standard' : 'Additional',
    });
  }
  for (const id of relevant) if (!seen.has(id)) throw new Error(`Linked transaction missing from Price Paid release: ${id}`);
  return [...records.values()].sort((left, right) => right.date.localeCompare(left.date) || left.transactionId.localeCompare(right.transactionId));
}