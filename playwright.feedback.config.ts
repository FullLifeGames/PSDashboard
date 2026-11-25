import { defineConfig } from '@playwright/test';

/** Feedback drift suite: warn-only, one worker (a sweep fills the pool), no retries (they hide nondeterminism). */
export default defineConfig({
  testDir: './test/e2e-feedback',
  timeout: 2_400_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${process.env.PS_DEV_PORT ?? 5176}`,
    headless: true,
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
