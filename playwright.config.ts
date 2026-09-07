import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e', workers: 1,
  use: { baseURL: 'http://127.0.0.1:4318', viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure' },
  webServer: { command: 'node --import tsx tests/serve.ts', url: 'http://127.0.0.1:4318/api/status', reuseExistingServer: false },
});