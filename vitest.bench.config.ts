import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The engine bench is no part of the suite: this config runs scripts/eval-bench.vt.ts alone.
const workspaceSource = (name: string) => fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@fulllifegames/replay-core': workspaceSource('replay-core'),
      '@fulllifegames/eval-engine': workspaceSource('eval-engine'),
    },
  },
  // A named reporter makes the bench's console lines print where vitest would pick a terse one.
  test: { environment: 'node', include: ['scripts/eval-bench.vt.ts'], testTimeout: 300_000, reporters: ['default'] },
});
