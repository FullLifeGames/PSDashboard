import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { emptySmogon, routeSmogon } from '../e2e/smogon-routes';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureReplay = JSON.parse(
  readFileSync(join(__dirname, '..', 'e2e', 'fixtures', 'replay.json'), 'utf-8'),
);

// `getFullDetails` is a method name of @pkmn/sim's Pokemon that minification keeps.
test('the start load holds no simulator code', async ({ request }) => {
  const html = await (await request.get('/')).text();
  const initial = [...html.matchAll(/(?:src|href)="\.?\/?(assets\/[^"]+\.js)"/g)].map(match => match[1]);
  expect(initial.length).toBeGreaterThan(0);
  const carriers: string[] = [];
  for (const file of initial) {
    if ((await (await request.get(`/${file}`)).text()).includes('getFullDetails')) carriers.push(file);
  }
  expect(carriers).toEqual([]);
});

test('a lazy chunk missing after a deploy reloads the page once, and the next load works', async ({ page }) => {
  test.setTimeout(120_000);
  await page.route('**/play.pokemonshowdown.com/js/replay-embed.js*', route =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.route('**/replay.pokemonshowdown.com/**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(fixtureReplay),
  }));
  await routeSmogon(page, emptySmogon);
  let refused = 0;
  await page.route('**/assets/opponent-inferrer-*.js', route => {
    if (refused > 0) return route.continue();
    refused += 1;
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto('/');
  const reloaded = page.waitForEvent('load');
  await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
  await reloaded;
  expect(refused).toBe(1);
  expect(await page.evaluate(() => sessionStorage.getItem('ps-replay-interceptor:stale-chunk-reload'))).not.toBeNull();
  await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
  await expect(page.locator('.ps-branch-bar input[type="range"]')).toBeVisible({ timeout: 60_000 });
});

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

  test('the build ships Opponent reads my move and the Game review switched off', async ({ page }) => {
    test.setTimeout(120_000);
    await page.evaluate(() => {
      localStorage.setItem('ps-replay-interceptor:eval-prefs',
        JSON.stringify({ depth: 1, samples: 1, mode: 'matrix', auto: false, tera: 'auto', hardMode: true }));
    });
    await page.reload();
    await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
    await expect(page.getByText('TestPlayer1', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: /^Setup/ }).click();
    await expect(page.getByRole('checkbox', { name: 'Animate branch turns' })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Opponent reads my move' })).toHaveCount(0);
    await expect(page.getByText('Opponent reads your move')).toHaveCount(0);
    await expect(page.getByText(/Game review/)).toHaveCount(0);
    await expect(page.locator('[data-review-mark]')).toHaveCount(0);
    expect(JSON.parse(await page.evaluate(() => localStorage.getItem('ps-replay-interceptor:eval-prefs') ?? '{}')).hardMode).toBe(true);
  });

  const analysisBySwitch: Record<string, string> = {};
  // @pkmn/sim serializes `[${obj.constructor.name}:id]`: a minified class name round-trips into a plain object.
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

      await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
      await expect(page.getByText('TestPlayer1', { exact: true }).first()).toBeVisible({ timeout: 30_000 });

      const panel = page.locator('.ps-main-right .ps-eval-panel');
      await panel.locator('button', { hasText: 'Analyze game' }).click();
      await expect(panel.locator('button', { hasText: 'Re-analyze' })).toBeVisible({ timeout: 180_000 });

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
