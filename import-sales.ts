import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { joinSales } from './apps/server/src/sales-import.ts';
import type { Parcel } from './packages/contracts/src/ownership.ts';
import type { SalesRelease } from './packages/contracts/src/sales.ts';

const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
async function download(url: string): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 100_000_000) throw new Error('Unexpectedly large source file');
  return bytes;
}

const currentPage = await download('https://www.gov.uk/government/statistical-data-sets/price-paid-data-downloads');
if (!currentPage.toString('utf8').includes('id="july-2026-data-current-month"')) {
  throw new Error('The rolling Price Paid download is no longer confirmed as July 2026. Do not mix releases.');
}
const urls = [
  'https://price-paid-data.publicdata.landregistry.gov.uk/pp-inspire-id-lookup-jul-2026.csv',
  'https://price-paid-data.publicdata.landregistry.gov.uk/pp-monthly-update-new-version.csv',
];
const inputs = await Promise.all(urls.map(download));
const pilotRaw = await readFile(resolve('public/pilot/parcels.json'));
const pilot = JSON.parse(pilotRaw.toString('utf8')) as { parcels: Parcel[] };
const records = joinSales(inputs[0].toString('utf8'), inputs[1].toString('utf8'), new Set(pilot.parcels.map(parcel => parcel.source!.inspireId)));
const release: SalesRelease = {
  period: '2026-07', importedAt: new Date().toISOString(), pilotSha256: hash(pilotRaw),
  sources: urls.map((url, index) => ({ url, sha256: hash(inputs[index]) })),
  attribution: 'Contains HM Land Registry data (c) Crown copyright and database right 2026. This data is licensed under the Open Government Licence v3.0.',
  licence: 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/',
  addressConditions: 'https://www.gov.uk/government/statistical-data-sets/price-paid-data-downloads#using-or-publishing-our-price-paid-data',
  records,
};
await mkdir(resolve('.local/sales-inputs'), { recursive: true });
for (const [index, source] of release.sources.entries()) await writeFile(resolve('.local/sales-inputs', `${source.sha256}.csv`), inputs[index]);
const target = resolve('public/pilot/sales.json');
await writeFile(`${target}.tmp`, JSON.stringify(release, null, 2) + '\n');
await rename(`${target}.tmp`, target);
console.log(JSON.stringify({ transactions: records.length, pilotParcels: pilot.parcels.filter(parcel => records.some(record => record.inspireIds.includes(parcel.source!.inspireId))).length, output: target }, null, 2));