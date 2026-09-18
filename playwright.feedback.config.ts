import { defineConfig } from '@playwright/test';

/**
 * Expert-feedback drift suite: drives the REAL app per pinned replay and
 * grades the 2026-08 corpus. Warn-only (drift is report content); reds are
 * harness breakage only. Deterministic by construction — retries would
 * only mask a determinism loss, so there are none. One worker: a single
 * sweep already saturates the eval worker pool.
 * Run: npm run test:feedback (on demand; never a standard gate). The dev
 * server comes from scripts/run-e2e.mjs --dev-port 5176: it waits until
 * Vite has bundled its dependencies before the first page opens, and it
 * refuses a port somebody else holds.
 */
export default defineConfig({
  testDir: './e2e-feedback',
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
