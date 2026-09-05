import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * The Node suites in one runner, three projects: the app's own specs plus the
 * integration and measurement-chain specs under regression/, and each
 * package's suite under packages/<name>/test/ (also runnable alone:
 * npm test -w packages/<name>). The browser suites (e2e, feedback, build
 * smoke) stay on Playwright.
 *
 * The workspace packages resolve to their sources, as in vite.config.ts and
 * the tsconfig paths: a test never sees a package's dist/.
 */
const root = fileURLToPath(new URL('.', import.meta.url));
const workspaceSource = (name: string) => fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

const project = (name: string, include: string) => ({
  extends: true as const,
  test: { name, include: [include] },
});

export default defineConfig({
  root,
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
    ],
  },
});
