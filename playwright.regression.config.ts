import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './regression',
  timeout: 60_000,
  retries: 0,
  use: {
    headless: true,
  },
  projects: [
    { name: 'reconstruction' },
  ],
});
