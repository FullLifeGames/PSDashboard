import { defineConfig } from '@playwright/test';

/**
 * Production-build suite: builds the app and drives the MINIFIED bundle
 * through a preview server. Kept separate from the dev e2e config (which
 * intentionally runs unminified sources for speed) because the failure it
 * guards against is minification-specific — see e2e-build/build-smoke.spec.
 *
 * Run: npm run test:build
 */
export default defineConfig({
  testDir: './e2e-build',
  timeout: 240_000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:4174',
    headless: true,
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
  webServer: {
    command: 'npm run build && npx vite preview --port 4174 --strictPort',
    url: 'http://localhost:4174',
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
