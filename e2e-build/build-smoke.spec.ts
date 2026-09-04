import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { emptySmogon, routeSmogon } from '../e2e/smogon-routes';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureReplay = JSON.parse(
  readFileSync(join(__dirname, '..', 'e2e', 'fixtures', 'replay.json'), 'utf-8'),
);

/**
 * PRODUCTION-BUILD smoke test. The dev suite runs against unminified
 * sources, which hid a build-only failure for as long as the feature has
 * existed: @pkmn/sim serializes battle references as
 * `[${obj.constructor.name}:id]`, so minified class names round-tripped
 * into objects that were no longer Pokemon/Side instances. Every search in
 * the worker threw `e?.getMoveRequestData is not a function`, the sweep
 * swallowed each one as a per-turn gap, and "Analyze game" produced an
 * EMPTY graph in the built app while dev looked perfect (2026-08-12).
 *
 * The guard is deliberately end-to-end and minimal: if a real position can
 * round-trip through the built worker and come back as a ranked search
 * result, class identity survived minification.
 */
test.describe('production build', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/play.pokemonshowdown.com/js/replay-embed.js*', route =>
      route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
    await page.route('**/replay.pokemonshowdown.com/**', route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(fixtureReplay),
    }));
    await routeSmogon(page, emptySmogon);
    await page.goto('/');
  });

  test('the minified worker still evaluates positions — the eval graph fills', async ({ page }) => {
    test.setTimeout(240_000);
    await page.evaluate(() => {
      localStorage.setItem('ps-replay-interceptor:eval-pool', '2');
      localStorage.setItem('ps-replay-interceptor:eval-prefs',
        JSON.stringify({ depth: 1, samples: 1, mode: 'matrix', auto: false, tera: 'auto' }));
    });
    await page.reload();

    // Any typed worker error is a build-integrity failure — collect them
    // rather than only asserting the visible outcome, so a regression names
    // its own cause instead of just "no points".
    await page.addInitScript(() => {
      const store = window as unknown as { __workerErrors: string[] };
      store.__workerErrors = [];
      const Original = window.Worker;
      class Traced extends Original {
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options);
          this.addEventListener('message', (event: MessageEvent) => {
            if (event.data?.type === 'error') store.__workerErrors.push(String(event.data.message));
          });
        }
      }
      window.Worker = Traced as unknown as typeof Worker;
    });
    await page.reload();

    await page.locator('button', { hasText: 'Load' }).click();
    await expect(page.getByText('TestPlayer1', { exact: true }).first()).toBeVisible({ timeout: 30_000 });

    const panel = page.locator('.ps-main-right .ps-eval-panel');
    await panel.locator('button', { hasText: 'Analyze game' }).click();
    await expect(panel.locator('button', { hasText: 'Re-analyze' })).toBeVisible({ timeout: 180_000 });

    // Points on the line == positions that survived the round trip.
    await expect(panel.locator('.ps-eval-graph circle')).not.toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __workerErrors: string[] }).__workerErrors)).toEqual([]);
  });
});
