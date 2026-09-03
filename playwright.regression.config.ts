import { defineConfig } from '@playwright/test';

/**
 * Three projects, one run: the app's own specs plus the integration and
 * measurement-chain specs under regression/, and each package's suite under
 * packages/<name>/test/ (also runnable alone: npm test -w packages/<name>).
 */
export default defineConfig({
  testDir: './regression',
  timeout: 60_000,
  retries: 0,
  use: {
    headless: true,
  },
  projects: [
    { name: 'app', testDir: './regression' },
    { name: 'replay-core', testDir: './packages/replay-core/test' },
    { name: 'eval-engine', testDir: './packages/eval-engine/test' },
  ],
});
