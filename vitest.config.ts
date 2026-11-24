import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Packages resolve to their sources, as in vite.config.ts and the tsconfig paths: a test never sees a dist/.
const workspaceSource = (name: string) => fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

const project = (name: string, include: string, extra: Record<string, unknown> = {}) => ({
  extends: true as const,
  test: { name, include: [include], ...extra },
});

// Includes are relative to the repository root: a package's own script passes --root ../.. to share this config.
export default defineConfig({
  resolve: {
    alias: {
      '@fulllifegames/replay-core': workspaceSource('replay-core'),
      '@fulllifegames/eval-engine': workspaceSource('eval-engine'),
    },
  },
  test: {
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts', 'src/**/*.{ts,tsx}'],
      exclude: ['**/*.d.ts'],
      reporter: ['json', 'json-summary', 'text-summary'],
      reportsDirectory: '.calibration/coverage',
      reportOnFailure: true,
    },
    projects: [
      project('app', 'test/regression/**/*.spec.ts'),
      project('replay-core', 'packages/replay-core/test/**/*.spec.ts'),
      project('eval-engine', 'packages/eval-engine/test/**/*.spec.ts'),
      project('ui', 'test/ui/**/*.spec.{ts,tsx}', {
        environment: 'jsdom',
        setupFiles: [fileURLToPath(new URL('./test/ui/setup.ts', import.meta.url))],
        // Both feature flags are off in every build; specs of the off state switch one off with `vi.stubEnv`.
        env: { VITE_FEATURE_GAME_REVIEW: '1', VITE_FEATURE_OPPONENT_READS: '1' },
      }),
    ],
  },
});
