import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * The engine bench (`npm run bench:eval`, scripts/eval-bench.vt.ts): forward-model and search throughput, printed to the console. It is no
 * part of the suite, so vitest.config.ts does not list it; this config runs that one file with the workspace packages resolved to their sources.
 */
const workspaceSource = (name: string) => fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@fulllifegames/replay-core': workspaceSource('replay-core'),
      '@fulllifegames/eval-engine': workspaceSource('eval-engine'),
    },
  },
  // The reporter is named so that the console lines of the bench print, also where vitest picks a terse reporter by itself.
  test: { environment: 'node', include: ['scripts/eval-bench.vt.ts'], testTimeout: 300_000, reporters: ['default'] },
});
