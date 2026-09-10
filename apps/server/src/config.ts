import { isAbsolute, join, relative, resolve } from 'node:path';

export interface RuntimeConfig {
  port: number;
  assetRoot: string;
  dataRoot: string;
  journal: string;
  investigationDb: string;
  runtimeLock: string;
  pilotPath: string;
  logPath: string;
}

function configuredPath(value: string | undefined, fallback: string, workingDirectory: string): string {
  const selected = value?.trim() || fallback;
  return isAbsolute(selected) ? resolve(selected) : resolve(workingDirectory, selected);
}

function comparablePath(path: string, platform: NodeJS.Platform): string {
  return platform === 'win32' ? path.toLowerCase() : path;
}

export function resolveRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env,
  workingDirectory = process.cwd(),
  platform: NodeJS.Platform = process.platform,
): RuntimeConfig {
  const port = Number(environment.PORT ?? 4317);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535');

  const assetRoot = configuredPath(environment.FIELDWORK_ASSET_DIR, 'dist', workingDirectory);
  const dataRoot = configuredPath(environment.FIELDWORK_DATA_DIR, '.local', workingDirectory);
  const relativeDataPath = relative(comparablePath(assetRoot, platform), comparablePath(dataRoot, platform));
  if (relativeDataPath === '' || (!relativeDataPath.startsWith('..') && !isAbsolute(relativeDataPath))) {
    throw new Error('Writable data must be outside the application asset directory');
  }

  return {
    port,
    assetRoot,
    dataRoot,
    journal: join(dataRoot, 'demo-reviews.jsonl'),
    investigationDb: join(dataRoot, 'investigations.sqlite'),
    runtimeLock: join(dataRoot, '.fieldwork-server.lock'),
    pilotPath: join(assetRoot, 'pilot', 'parcels.json'),
    logPath: join(dataRoot, 'logs', 'fieldwork.jsonl'),
  };
}