import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * The Node and jsdom suites in one runner, four projects: the app's own specs
 * plus the integration and measurement-chain specs under regression/, each
 * package's suite under packages/<name>/test/ (also runnable alone:
 * npm test -w packages/<name>), and the app suite under ui/ (components and
 * hooks with Testing Library on jsdom, `npm run test:ui`). The browser suites
 * (e2e, feedback, build smoke) stay on Playwright.
 *
 * The workspace packages resolve to their sources, as in vite.config.ts and
 * the tsconfig paths: a test never sees a package's dist/.
 */
const workspaceSource = (name: string) => fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

const project = (name: string, include: string, extra: Record<string, unknown> = {}) => ({
  extends: true as const,
  test: { name, include: [include], ...extra },
});

// The includes are relative to the repository root; a package's own test
// script passes --root ../.. so the same config serves it from its directory.
export default defineConfig({
  resolve: {
    alias: {
      '@fulllifegames/replay-core': workspaceSource('replay-core'),
      '@fulllifegames/eval-engine': workspaceSource('eval-engine'),
    },
  },
  test: {
    environment: 'node',
    // Reconstruction and search pins replay whole games; the heaviest tests
    // raise their own timeout in the test options.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    projects: [
      project('app', 'regression/**/*.spec.ts'),
      project('replay-core', 'packages/replay-core/test/**/*.spec.ts'),
      project('eval-engine', 'packages/eval-engine/test/**/*.spec.ts'),
      project('ui', 'ui/**/*.spec.{ts,tsx}', { environment: 'jsdom', setupFiles: [fileURLToPath(new URL('./ui/setup.ts', import.meta.url))] }),
    ],
  },
});
