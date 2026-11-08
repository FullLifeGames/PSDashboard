import { test, expect, type Page } from '@playwright/test';
import { installReplayEmbedCache, routeOfflineFixtures, startVariationAt } from './helpers';
import { failOnResizeLoops, lightEngine, loadDockReplay } from './dock-helpers';

/**
 * Round 88 (T345, #81): the timeline bar keeps its slider in line at every width. At a ladder of window widths, with and without a
 * variation, in a singles replay and a doubles replay: every item on the step buttons' row has its centre within 1 px of theirs
 * (the 1050 px query used to hang the items from the top of the row: the slider sat 6 px high, 9 px with a variation); the slider is
 * at least 200 px wide (the user's ruling of 07.11.2026: below that the line chip and Discard variation take a second row); and at
 * 640 px and less the slider's own row draws the thin track without the grey block of the 28 px touch box.
 */
const WIDTHS = [2560, 1920, 1440, 1100, 1051, 1050, 1000, 800, 700, 641, 640, 390];
const heightOf = (width: number) => (width === 390 ? 844 : width === 2560 ? 1400 : width === 1920 ? 1050 : 800);
const MIN_SLIDER = 200;
const DOUBLES = 'gen9doublesou-2693620934';
const DOUBLES_TURN = 5;

test.beforeAll(installReplayEmbedCache);
failOnResizeLoops(test);

test.beforeEach(async ({ page }) => {
  await lightEngine(page);
  await routeOfflineFixtures(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
});

interface Item { name: string; top: number; bottom: number; mid: number; width: number }
interface BarReading {
  items: Item[];
  slider: { width: number; mid: number };
  range: { backgroundColor: string; backgroundSize: string; backgroundImage: string; boxShadow: string; height: number };
}

/** The bar's items in layout order (the chip and Discard variation sit in their wrapper), the slider's width and the range's paint. */
async function readBar(page: Page): Promise<BarReading> {
  return page.evaluate(() => {
    const bar = document.querySelector('.ps-branch-bar') as HTMLElement;
    const parts = [...bar.children].flatMap(element => (element.matches('.ps-branch-bar-vari') ? [...element.children] : [element])) as HTMLElement[];
    const nameOf = (element: HTMLElement) => (element.matches('.ps-timeline-track') ? 'slider'
      : element.matches('.ps-line-chip') ? 'chip' : (element.textContent ?? '').trim().slice(0, 20) || element.tagName);
    const items = parts.map(element => {
      const rect = element.getBoundingClientRect();
      return { name: nameOf(element), top: rect.top, bottom: rect.bottom, mid: rect.top + rect.height / 2, width: rect.width };
    });
    const input = bar.querySelector('input[type="range"]') as HTMLInputElement;
    const box = input.getBoundingClientRect();
    const style = getComputedStyle(input);
    return {
      items,
      slider: { width: box.width, mid: box.top + box.height / 2 },
      range: { backgroundColor: style.backgroundColor, backgroundSize: style.backgroundSize, backgroundImage: style.backgroundImage, boxShadow: style.boxShadow, height: box.height },
    };
  });
}

/** Resizes the window and reads the bar once two reads 80 ms apart agree (the app's scale and the layout settle after a resize). */
async function readAt(page: Page, width: number): Promise<BarReading> {
  await page.setViewportSize({ width, height: heightOf(width) });
  let last = '';
  let reading: BarReading | null = null;
  await expect.poll(async () => {
    reading = await readBar(page);
    const now = JSON.stringify(reading);
    const same = now === last;
    last = now;
    await page.waitForTimeout(80);
    return same;
  }, { timeout: 10_000 }).toBe(true);
  return reading!;
}

function expectInLine(reading: BarReading, where: string): void {
  const arrow = reading.items.find(item => item.name === '◀');
  expect(arrow, `${where}: the back arrow`).toBeTruthy();
  // The step buttons' row: every item that does not hang below the arrow. Items on a lower row (the slider's own row at 640 px
  // and less, the second row of the chip and Discard variation) are checked against their own row's items.
  const first = reading.items.filter(item => item.top < arrow!.bottom - 1);
  for (const item of first) {
    expect(Math.abs(item.mid - arrow!.mid), `${where}: ${item.name} centre ${item.mid.toFixed(1)} against the arrow's ${arrow!.mid.toFixed(1)}`).toBeLessThanOrEqual(1);
  }
  const lower = reading.items.filter(item => item.top >= arrow!.bottom - 1);
  const rows = new Map<number, Item[]>();
  for (const item of lower) {
    const key = [...rows.keys()].find(top => Math.abs(top - item.top) < item.bottom - item.top) ?? item.top;
    rows.set(key, [...(rows.get(key) ?? []), item]);
  }
  for (const row of rows.values()) {
    const mids = row.map(item => item.mid);
    // The slider's touch box and the buttons beside it share one row: their centres agree as well.
    expect(Math.max(...mids) - Math.min(...mids), `${where}: the items of a lower row (${row.map(item => item.name).join(', ')})`).toBeLessThanOrEqual(1);
  }
}

function expectBar(reading: BarReading, width: number, where: string): void {
  expectInLine(reading, where);
  expect(reading.slider.width, `${where}: the slider's width`).toBeGreaterThanOrEqual(MIN_SLIDER - 0.5);
  if (width <= 640) {
    expect(reading.range.backgroundColor, `${where}: no grey block behind the 28 px touch box`).toBe('rgba(0, 0, 0, 0)');
    expect(reading.range.boxShadow, `${where}: no shadow block`).toBe('none');
    expect(reading.range.backgroundImage, `${where}: the thin track`).toContain('gradient');
    expect(reading.range.backgroundSize, `${where}: the thin track is 6 px tall`).toContain('6px');
    expect(reading.range.height, `${where}: the touch box`).toBeGreaterThanOrEqual(28 - 0.5);
  } else {
    expect(reading.range.backgroundColor, `${where}: the 6 px track keeps its grey`).toBe('rgb(85, 85, 85)');
  }
}

async function readLadder(page: Page, scene: string, variation: boolean): Promise<void> {
  for (const width of WIDTHS) {
    const where = `${scene}, ${variation ? 'with' : 'without'} a variation, ${width} px`;
    const reading = await readAt(page, width);
    expectBar(reading, width, where);
    if (!variation || width <= 640) continue;
    // The chip and Discard variation share the step buttons' row while the slider keeps its 200 px, and take a second row below
    // it where it would not (the one-row slider falls under 200 px from 1051 px up to about 1161 px and between 641 and about 765 px).
    const arrow = reading.items.find(item => item.name === '◀')!;
    const secondRow = [1100, 1051, 700, 641].includes(width);
    for (const name of ['chip', 'Discard variation']) {
      const item = reading.items.find(candidate => candidate.name === name)!;
      expect(item.top >= arrow.bottom - 1, `${where}: ${name} on the ${secondRow ? 'second' : 'first'} row`).toBe(secondRow);
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

test('singles: the bar keeps its slider in line at every width, with and without a variation', async ({ page }) => {
  test.setTimeout(180_000);
  await page.locator('button', { hasText: 'Load' }).click();
  await expect(page.locator('.ps-branch-bar input[type="range"]')).toBeVisible({ timeout: 30_000 });
  await readLadder(page, 'singles', false);
  await startVariationAt(page, 1);
  await expect(page.locator('.ps-line-chip')).toBeVisible();
  await readLadder(page, 'singles', true);
});

test('doubles: the bar keeps its slider in line at every width, with and without a variation', async ({ page }) => {
  test.setTimeout(180_000);
  await loadDockReplay(page, DOUBLES, DOUBLES_TURN);
  await readLadder(page, 'doubles', false);
  await startVariationAt(page, DOUBLES_TURN);
  await expect(page.locator('.ps-line-chip')).toBeVisible();
  await readLadder(page, 'doubles', true);
});
