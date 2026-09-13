import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
export default defineConfig({
  testDir: './tests/browser',
  use: { baseURL: 'http://127.0.0.1:3012', locale: 'en-US', viewport: { width: 1440, height: 900 }, screenshot: 'only-on-failure' },
  workers: 1,
  reporter: 'list',
  webServer: { command: 'tsx karui/scripts/panel-test-server.ts', cwd: resolve(import.meta.dirname, '..'), url: 'http://127.0.0.1:3012/healthz', reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === '1', timeout: 30_000 },
});
