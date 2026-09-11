import { resolve } from 'node:path';
import { licensedProviderSchema, providerReadiness } from '../../../packages/contracts/src/licensed-provider.ts';
import { readBoundedFile, stageLicensedOwnership, verifyLicensedArchive } from './licensed-staging.ts';
import { resolveRuntimeConfig } from './config.ts';

const [command, profilePath, mappingPath, csvPath, ...extra] = process.argv.slice(2);
try {
  if (command === 'check' && profilePath && !mappingPath && !csvPath && !extra.length) {
    const profile = licensedProviderSchema.parse(JSON.parse(readBoundedFile(resolve(profilePath), 64_000).toString('utf8')));
    const result = providerReadiness(profile, undefined, process.env);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ready) process.exitCode = 2;
  } else if (command === 'verify' && profilePath && !mappingPath && !csvPath && !extra.length) {
    const result = verifyLicensedArchive(resolve(profilePath));
    console.log(JSON.stringify(result, null, 2));
    if (!result.licenceCurrentlyReady) process.exitCode = 2;
  } else if (command === 'stage' && profilePath && mappingPath && csvPath && !extra.length) {
    const config = resolveRuntimeConfig();
    const result = stageLicensedOwnership({ profilePath: resolve(profilePath), mappingPath: resolve(mappingPath), csvPath: resolve(csvPath), dataRoot: config.dataRoot, assetRoot: config.assetRoot });
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.error('Usage: provider-cli check <profile.json> | stage <profile.json> <mapping.json> <ownership.csv> | verify <staged.zip>');
    process.exitCode = 2;
  }
} catch {
  console.error('Provider preparation failed. Check profile approval/dates/permissions, column mapping, UTF-8 input and private storage access. No case records were changed. Input values and credentials are not logged.');
  process.exitCode = 1;
}