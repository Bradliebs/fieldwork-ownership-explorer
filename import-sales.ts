import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { importSalesRelease, salesImportMetadataSchema } from './apps/server/src/release-import.ts';

const [metadataPath, outputPath = 'public/pilot', cachePath = '.local/source-cache'] = process.argv.slice(2);
if (!metadataPath) throw new Error('Usage: tsx import-sales.ts sales-import.json [release-directory] [source-cache-directory]');
const metadataFile = resolve(metadataPath);
const metadata = salesImportMetadataSchema.parse(JSON.parse(await readFile(metadataFile, 'utf8')));
metadata.lookup.path = resolve(dirname(metadataFile), metadata.lookup.path);
metadata.pricePaid.path = resolve(dirname(metadataFile), metadata.pricePaid.path);
const result = await importSalesRelease({ outputRoot: resolve(outputPath), sourceCacheRoot: resolve(cachePath), metadata });
console.log(JSON.stringify({ transactions: result.release.records.length, releaseId: result.descriptor.releaseId, output: resolve(outputPath) }, null, 2));