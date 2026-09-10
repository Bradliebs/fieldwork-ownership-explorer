import fastifyStatic from '@fastify/static';
import { join } from 'node:path';
import { buildServer } from './server.ts';
import { resolveRuntimeConfig } from './config.ts';
import { assertNoPendingRestore } from './runtime-lock.ts';
import { createReleaseStore } from './release-store.ts';
import { acquireInstanceLock } from './instance-lock.ts';
import { monitorShutdownRequest } from './shutdown-request.ts';

async function start(): Promise<void> {
  const config = resolveRuntimeConfig();
  const url = `http://127.0.0.1:${config.port}`;
  const instance = acquireInstanceLock(config.runtimeLock, url);
  if (!instance.acquired) {
    console.log(`Ownership Explorer is already running at ${instance.url} (PID ${instance.pid})`);
    return;
  }
  let app: ReturnType<typeof buildServer> | undefined;
  let stopShutdownMonitor: (() => void) | undefined;
  try {
    assertNoPendingRestore(config.dataRoot);
    const activeRelease = await createReleaseStore({ root: config.dataRoot, runtimeLock: config.runtimeLock })
      .initialize(join(config.assetRoot, 'pilot'), true);
    app = buildServer({ ...config, releaseId: activeRelease.descriptor.releaseId, pilotPath: join(activeRelease.path, 'parcels.json') });
    app.addHook('onClose', async () => {
      stopShutdownMonitor?.();
      instance.release();
    });
    await app.register(fastifyStatic, { root: config.assetRoot });
    await app.listen({ host: '127.0.0.1', port: config.port });
    stopShutdownMonitor = monitorShutdownRequest(
      join(config.dataRoot, '.fieldwork-shutdown-request.json'),
      instance.id,
      () => { void app?.close(); },
    );
  } catch (error) {
    if (app) await app.close();
    else instance.release();
    throw error;
  }
  console.log(`Ownership Explorer: ${url} (Bristol pilot; local investigations)`);
  process.once('exit', instance.release);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, async () => { await app?.close(); process.exit(0); });
  }
}

await start();