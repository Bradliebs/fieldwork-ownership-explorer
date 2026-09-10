import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  publicDir: false,
  build: {
    ssr: true,
    target: 'node24',
    outDir: 'build/server',
    emptyOutDir: true,
    rolldownOptions: {
      input: {
        main: resolve(root, 'apps/server/src/main.ts'),
        'backup-cli': resolve(root, 'apps/server/src/backup-cli.ts'),
        'release-cli': resolve(root, 'apps/server/src/release-cli.ts'),
      },
      output: { entryFileNames: '[name].js' },
    },
  },
  ssr: { noExternal: true },
});