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
test.describe.serial('production build', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/play.pokemonshowdown.com/js/replay-embed.js*', route =>
      route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
    await page.route('**/replay.pokemonshowdown.com/**', route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(fixtureReplay),
    }));
    await routeSmogon(page, emptySmogon);
    await page.goto('/');
  });

  const analysisBySwitch: Record<string, string> = {};
  for (const simFast of ['0', '1'] as const) {
    test(`the minified worker still evaluates positions (speed layer ${simFast}): the eval graph fills`, async ({ page }) => {
      test.setTimeout(240_000);
      await page.evaluate(value => {
        localStorage.setItem('ps-replay-interceptor:eval-pool', '2');
        localStorage.setItem('ps-replay-interceptor:eval-prefs',
          JSON.stringify({ depth: 1, samples: 1, mode: 'matrix', auto: false, tera: 'auto' }));
        localStorage.setItem('ps-replay-interceptor:sim-fast', value);
        localStorage.setItem('ps-replay-interceptor:perf', '1');
      }, simFast);
      await page.reload();

      // Any typed worker error is a build-integrity failure — collect them
      // rather than only asserting the visible outcome, so a regression names
      // its own cause instead of just "no points". Round 59: the tracer also
      // keeps each worker's speed-layer reports, so the gate checks every
      // evaluation worker on its own.
      await page.addInitScript(() => {
        type WorkerReports = { statuses: string[]; clones: number; dispatchAnswered: number; kinds: string[] };
        const store = window as unknown as { __workerErrors: string[]; __simFastByWorker: WorkerReports[] };
        store.__workerErrors = [];
        store.__simFastByWorker = [];
        const Original = window.Worker;
        class Traced extends Original {
          constructor(url: string | URL, options?: WorkerOptions) {
            super(url, options);
            const mine: WorkerReports = { statuses: [], clones: 0, dispatchAnswered: 0, kinds: [] };
            store.__simFastByWorker.push(mine);
            this.addEventListener('message', (event: MessageEvent) => {
              if (event.data?.type === 'error') store.__workerErrors.push(String(event.data.message));
              const report = event.data?.simFast;
              if (report) {
                mine.statuses.push(report.status);
                mine.clones += report.counters.clones;
                mine.dispatchAnswered += report.counters.dispatchAnswered;
                mine.kinds.push(event.data.type);
              }
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

      const counters = await page.evaluate(() =>
        (window as unknown as { __EVAL_PERF__?: { counters: Record<string, number> } }).__EVAL_PERF__?.counters ?? {});
      const workers = await page.evaluate(() => (window as unknown as {
        __simFastByWorker: { statuses: string[]; clones: number; dispatchAnswered: number; kinds: string[] }[];
      }).__simFastByWorker);
      const cellWorkers = workers.filter(worker => worker.kinds.includes('cellsResult'));
      expect(cellWorkers.length).toBeGreaterThan(0);
      if (simFast === '1') {
        for (const name of ['simFast:status:active', 'simFast:ruleTables', 'simFast:clones', 'simFast:dispatchAnswered']) {
          expect(counters[name] ?? 0, name).toBeGreaterThan(0);
        }
        for (const name of ['simFast:status:off', 'simFast:status:fallback', 'simFast:status:hash-mismatch']) {
          expect(counters[name] ?? 0, name).toBe(0);
        }
        for (const worker of workers) expect(worker.statuses.every(status => status === 'active')).toBe(true);
        for (const worker of cellWorkers) {
          expect(worker.clones).toBeGreaterThan(0);
          expect(worker.dispatchAnswered).toBeGreaterThan(0);
        }
      } else {
        expect(counters['simFast:status:off'] ?? 0).toBeGreaterThan(0);
        expect(counters['simFast:clones'] ?? 0).toBe(0);
        for (const worker of workers) expect(worker.statuses.every(status => status === 'off')).toBe(true);
      }
      analysisBySwitch[simFast] = await page.evaluate(() => {
        const debug = (window as unknown as { __psDebug: { graph: unknown; analyses: unknown; gameReport: unknown } }).__psDebug;
        return JSON.stringify({ graph: debug.graph, analyses: debug.analyses, gameReport: debug.gameReport });
      });
      if (simFast === '1') expect(analysisBySwitch['1']).toBe(analysisBySwitch['0']);
    });
  }
});
