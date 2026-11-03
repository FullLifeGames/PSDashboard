import { test, type Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { fixtureReplay, installReplayEmbedCache, routeOfflineFixtures, startVariationAt } from './helpers';
import { lightEngine, loadDockReplay, pinUiScale } from './dock-helpers';

/**
 * Round 84 (T315, A7d, spec addendum A, "the sweet spot"): an opt-in measurement, never part of a run until `PS_SWEET_SPOT=1` is set.
 * At 100 % it finds, per scene, the smallest window at which the left column fits without scrolling and the evaluation column shows
 * its head: the smallest height at five widths and the smallest width at a tall window, in steps of 10 px. The scenes are a replay
 * turn and a variation with the history panel showing, in singles and in doubles. The numbers go to `test-results/sweet-spot.json`
 * (merged scene by scene), and decide whether Auto's room of 1400 x 820 px stands.
 *
 *   PS_SWEET_SPOT=1 PS_DEV_PORT=<port> npx playwright test test/e2e/sweet-spot.spec.ts --project=chromium
 *
 * "Fits" reads: the left column's content is no taller than its box (no scroll), the page has no sideways scroll, and the first
 * element of the right column lies inside the window. The scan assumes that a window which fits keeps fitting when it grows.
 */
test.skip(process.env.PS_SWEET_SPOT !== '1', 'an opt-in measurement: set PS_SWEET_SPOT=1');

const DOUBLES = 'gen9doublesou-2693620934';
const WIDTHS = [1100, 1280, 1400, 1600, 1920];
const TALL = 1400;
const STEP = 10;
const OUTPUT = 'test-results/sweet-spot.json';

interface Scene { name: string; setup: (page: Page) => Promise<void> }

const SCENES: Scene[] = [
  { name: 'replay-singles', setup: page => loadDockReplay(page, fixtureReplay.id, 1) },
  { name: 'replay-doubles', setup: page => loadDockReplay(page, DOUBLES, 5) },
  { name: 'variation-singles', setup: async page => { await loadDockReplay(page, fixtureReplay.id, 1); await startVariationAt(page, 1); } },
  { name: 'variation-doubles', setup: async page => { await loadDockReplay(page, DOUBLES, 5); await startVariationAt(page, 5); } },
];

async function fits(page: Page, width: number, height: number): Promise<boolean> {
  await page.setViewportSize({ width, height });
  // Two animation frames: the layout observers (the layout height) have run.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  return page.evaluate(() => {
    const left = document.querySelector('.ps-main-left') as HTMLElement;
    const head = (document.querySelector('.ps-main-right') as HTMLElement).firstElementChild!.getBoundingClientRect();
    return left.scrollHeight - left.clientHeight <= 1
      && document.documentElement.scrollWidth - window.innerWidth <= 0
      && head.top >= 0 && head.bottom <= window.innerHeight;
  });
}

/** The smallest value in [low, high], in steps, for which `ok` holds; null when not even `high` does. */
async function smallest(low: number, high: number, ok: (value: number) => Promise<boolean>): Promise<number | null> {
  if (!(await ok(high))) return null;
  let lo = Math.ceil(low / STEP);
  let hi = Math.floor(high / STEP);
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (await ok(mid * STEP)) hi = mid;
    else lo = mid + 1;
  }
  return lo * STEP;
}

function record(scene: string, numbers: unknown): void {
  mkdirSync('test-results', { recursive: true });
  const all = existsSync(OUTPUT) ? JSON.parse(readFileSync(OUTPUT, 'utf-8')) as Record<string, unknown> : {};
  all[scene] = numbers;
  writeFileSync(OUTPUT, `${JSON.stringify(all, null, 2)}\n`);
}

for (const scene of SCENES) {
  test(`sweet spot: ${scene.name}`, async ({ page }) => {
    test.setTimeout(600_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await lightEngine(page);
    await pinUiScale(page, 1);
    await routeOfflineFixtures(page);
    await page.goto('/');
    await scene.setup(page);
    const minHeightByWidth: Record<string, number | null> = {};
    for (const width of WIDTHS) minHeightByWidth[width] = await smallest(480, TALL, height => fits(page, width, height));
    const minWidthAtTall = await smallest(1060, 2400, width => fits(page, width, TALL));
    record(scene.name, { step: STEP, minHeightByWidth, tallHeight: TALL, minWidthAtTallHeight: minWidthAtTall });
  });
}

test.beforeAll(installReplayEmbedCache);
