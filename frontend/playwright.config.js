import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', timeout: 60000, workers: 1,
  use: { baseURL: process.env.UI_TEST_URL || 'http://127.0.0.1:3000', channel: 'msedge', viewport: { width: 1440, height: 1000 }, screenshot: 'only-on-failure' },
  reporter: [['list']],
});
