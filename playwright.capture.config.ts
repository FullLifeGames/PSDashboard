import { defineConfig } from '@playwright/test';

/** The capture of saved engine results (scripts/capture-eval-store.mjs); one worker, as a sweep fills the pool. */
export default defineConfig({
  testDir: './test/e2e-capture',
  timeout: 1_800_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${process.env.PS_DEV_PORT ?? 5177}`,
    headless: true,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
