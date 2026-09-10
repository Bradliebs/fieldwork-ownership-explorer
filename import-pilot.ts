import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { importPilotRelease, pilotImportMetadataSchema } from './apps/server/src/pilot-import.ts';

const [metadataPath, outputPath = 'public/pilot', cachePath = '.local/source-cache'] = process.argv.slice(2);
if (!metadataPath) throw new Error('Usage: tsx import-pilot.ts pilot-import.json [release-directory] [source-cache-directory]');
const metadataFile = resolve(metadataPath);
const metadata = pilotImportMetadataSchema.parse(JSON.parse(readFileSync(metadataFile, 'utf8')));
for (const source of [metadata.archive, metadata.osm, metadata.grid]) source.path = resolve(dirname(metadataFile), source.path);
const result = await importPilotRelease({ outputRoot: resolve(outputPath), sourceCacheRoot: resolve(cachePath), metadata });
console.log(JSON.stringify({ ...result, output: resolve(outputPath) }, null, 2));