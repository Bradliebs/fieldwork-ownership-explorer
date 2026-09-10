const { execFile, spawn } = require('node:child_process');
const { join } = require('node:path');

const root = __dirname;
const port = process.env.PORT || '4317';
const url = `http://127.0.0.1:${port}`;
const environment = {
  ...process.env,
  FIELDWORK_ASSET_DIR: join(root, 'assets'),
  FIELDWORK_DATA_DIR: process.env.FIELDWORK_DATA_DIR || join(process.env.LOCALAPPDATA, 'Fieldwork Ownership Explorer'),
};
const server = spawn(join(root, 'runtime', 'node.exe'), [join(root, 'app', 'main.js')], {
  detached: true,
  env: environment,
  stdio: 'ignore',
  windowsHide: true,
});
server.unref();

async function openWhenReady() {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) {
        execFile('cmd.exe', ['/d', '/c', 'start', '', url], { windowsHide: true });
        return;
      }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  console.error(`Fieldwork did not become ready at ${url}. See the operational log for details.`);
  process.exitCode = 1;
}

void openWhenReady();