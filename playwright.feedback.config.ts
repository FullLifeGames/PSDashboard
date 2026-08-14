import { defineConfig } from '@playwright/test';

/**
 * Expert-feedback drift suite: drives the REAL app per pinned replay and
 * grades the 2026-08 corpus. Warn-only (drift is report content); reds are
 * harness breakage only. Deterministic by construction — retries would
 * only mask a determinism loss, so there are none. One worker: a single
 * sweep already saturates the eval worker pool.
 * Run: npm run test:feedback (on demand; never a standard gate)
 */
export default defineConfig({
  testDir: './e2e-feedback',
  timeout: 2_400_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5176',
    headless: true,
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
  webServer: {
    command: 'npm run dev -- --port 5176 --strictPort',
    url: 'http://localhost:5176',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
