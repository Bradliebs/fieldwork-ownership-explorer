import { readFileSync, rmSync, unwatchFile, watchFile } from 'node:fs';
import { z } from 'zod';

const shutdownRequestSchema = z.object({
  instanceId: z.string().uuid(),
  requestedAt: z.string().datetime({ offset: true }),
}).strict();

export function monitorShutdownRequest(
  path: string,
  instanceId: string,
  onRequest: () => void,
  interval = 250,
): () => void {
  let accepted = false;
  const inspect = () => {
    let request: z.infer<typeof shutdownRequestSchema> | undefined;
    try { request = shutdownRequestSchema.parse(JSON.parse(readFileSync(path, 'utf8'))); }
    catch { return; }
    rmSync(path, { force: true });
    if (!accepted && request.instanceId === instanceId) {
      accepted = true;
      onRequest();
    }
  };
  watchFile(path, { interval, persistent: false }, inspect);
  inspect();
  return () => unwatchFile(path, inspect);
}