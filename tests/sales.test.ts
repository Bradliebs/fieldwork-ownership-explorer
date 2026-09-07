import { test } from 'node:test';
import assert from 'node:assert/strict';
import { joinSales } from '../apps/server/src/sales-import.ts';

const id = '{12345678-1234-1234-1234-123456789ABC}';
const csv = (rows: string[][]) => rows.map(row => row.map(value => '"' + value.replaceAll('"', '""') + '"').join(',')).join('\r\n');
const sale = [id, '250000', '2026-07-03 00:00', 'BS1 1AA', 'T', 'N', 'F', '12', '', 'DOCK, STREET', '', 'BRISTOL', 'CITY OF BRISTOL', 'BRISTOL', 'A', 'A'];
const lookup = csv([[id, '123'], [id, '456'], [id, '123']]);

test('sales join preserves multi-polygon transactions and quoted addresses without ownership claims', () => {
  const records = joinSales(lookup, csv([sale]), new Set(['123']));
  assert.equal(records.length, 1);
  assert.deepEqual(records[0].inspireIds, ['123', '456']);
  assert.equal(records[0].price, 250000);
  assert.equal(records[0].address, '12, DOCK, STREET, BRISTOL, BS1 1AA');
  assert.equal(records[0].date, '2026-07-03');
  assert.equal('proprietors' in records[0], false);
  assert.deepEqual(joinSales(lookup, csv([sale]), new Set(['999'])), []);
});

test('monthly changes use corrected record and exclude deleted sales', () => {
  assert.equal(joinSales(lookup, csv([[...sale.slice(0, 15), 'C']]), new Set(['123']))[0].price, 250000);
  assert.deepEqual(joinSales(lookup, csv([[...sale.slice(0, 15), 'D']]), new Set(['123'])), []);
});

test('sales import rejects incomplete, conflicting and invalid evidence', () => {
  assert.throws(() => joinSales(lookup, '', new Set(['123'])), /missing/);
  assert.throws(() => joinSales(lookup, csv([sale, sale]), new Set(['123'])), /Duplicate/);
  for (const [index, value] of [[1, '-50'], [2, '2026-02-30 00:00'], [6, 'L'], [15, 'X']] as const) {
    const invalid = [...sale]; invalid[index] = value;
    assert.throws(() => joinSales(lookup, csv([invalid]), new Set(['123'])));
  }
  assert.throws(() => joinSales(csv([[id, 'bad']]), csv([sale]), new Set(['123'])), /lookup/);
});