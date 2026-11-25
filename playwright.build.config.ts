import { defineConfig } from '@playwright/test';

/** The production-build suite: drives the minified bundle through a preview server (run: `npm run test:build`). */
export default defineConfig({
  testDir: './test/e2e-build',
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
