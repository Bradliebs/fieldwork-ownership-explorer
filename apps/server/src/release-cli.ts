import { resolve } from 'node:path';
import { resolveRuntimeConfig } from './config.ts';
import { createReleaseStore } from './release-store.ts';

const [command, argument] = process.argv.slice(2);
const config = resolveRuntimeConfig();
const store = createReleaseStore({ root: config.dataRoot, runtimeLock: config.runtimeLock });

switch (command) {
  case 'stage': {
    if (!argument) throw new Error('Usage: npm run release:stage -- <candidate-directory>');
    const release = await store.stage(resolve(argument));
    console.log(JSON.stringify({ staged: release.descriptor.releaseId, path: release.path }, null, 2));
    break;
  }
  case 'activate': {
    if (!argument) throw new Error('Usage: npm run release:activate -- <release-id>');
    const release = await store.activate(argument);
    console.log(JSON.stringify({ active: release.descriptor.releaseId }, null, 2));
    break;
  }
  case 'rollback': {
    const release = await store.rollback();
    console.log(JSON.stringify({ active: release.descriptor.releaseId, rolledBack: true }, null, 2));
    break;
  }
  case 'status': {
    const release = await store.active();
    console.log(JSON.stringify(release ? { active: release.descriptor.releaseId, descriptor: release.descriptor } : { active: null }, null, 2));
    break;
  }
  default:
    throw new Error('Usage: release-cli.ts <stage|activate|rollback|status> [argument]');
}