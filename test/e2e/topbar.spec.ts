import { test, expect, type Page } from '@playwright/test';
import { dockReplays, installReplayEmbedCache, routeOfflineFixtures } from './helpers';
import { failOnResizeLoops, lightEngine, loadDockReplay } from './dock-helpers';

/**
 * Round 84 (A7f, ruling 19a): the top bar stays on one line with a long format name. The user's game was a Champions VGC replay
 * ("[Gen 9 Champions] VGC 2026 Reg M-B (Bo3)", SpiringOcean against sigueinventando): the support links wrapped to a second line
 * because the match took its whole text as its basis. Now the match takes what the menus and links leave, the format tag shortens
 * first with an ellipsis and holds its full name in a title, and the player names shorten only after it. The fixture is the Champions
 * VGC corpus game with its `format` and `players` replaced; the rules still come from its `formatid` and log.
 */
const ID = 'gen9championsvgc2026regma-2625939941';
const FORMAT = '[Gen 9 Champions] VGC 2026 Reg M-B (Bo3)';
const PLAYERS = ['SpiringOcean', 'sigueinventando'];

test.beforeAll(installReplayEmbedCache);
failOnResizeLoops(test);

async function loadLongNames(page: Page): Promise<void> {
  await lightEngine(page);
  await routeOfflineFixtures(page);
  const replay = dockReplays.find(candidate => candidate.id === ID)!;
  // The last route registered answers first, so this one wins over the offline fixtures' for the same replay.
  await page.route('**/replay.pokemonshowdown.com/**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ ...replay, format: FORMAT, players: PLAYERS }),
  }));
  await page.goto('/');
  await loadDockReplay(page, ID, 1);
}

for (const viewport of [{ width: 2560, height: 1290 }, { width: 1366, height: 768 }]) {
  test(`${viewport.width} x ${viewport.height}: the bar's children share one line, the tag holds the full name`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(viewport);
    await loadLongNames(page);
    const tag = page.locator('.ps-topbar-match .ps-format-tag');
    await expect(tag).toHaveText(FORMAT);
    await expect(tag).toHaveAttribute('title', FORMAT);
    const names = page.locator('.ps-topbar-match .ps-player');
    await expect(names).toHaveCount(2);
    for (const [index, name] of PLAYERS.entries()) await expect(names.nth(index)).toHaveAttribute('title', name);

    const facts = await page.evaluate(() => {
      const bar = document.querySelector('.ps-topbar') as HTMLElement;
      const rects = [...bar.children].map(child => child.getBoundingClientRect());
      const clipped = (selector: string) => [...bar.querySelectorAll<HTMLElement>(selector)].map(element => element.scrollWidth > element.clientWidth + 1);
      return {
        count: rects.length, tops: rects.map(rect => rect.top), bottoms: rects.map(rect => rect.bottom),
        tagClipped: clipped('.ps-format-tag')[0], namesClipped: clipped('.ps-player'),
      };
    });
    const message = JSON.stringify(facts);
    expect(facts.count, message).toBeGreaterThanOrEqual(3);
    // One line: a horizontal line through the bar crosses every child.
    expect(Math.max(...facts.tops), `the bar's children share one line ${message}`).toBeLessThan(Math.min(...facts.bottoms));
    // The tag gives way first: while it clips, the names stay whole.
    if (facts.tagClipped) expect(facts.namesClipped, `the names stay whole while the tag clips ${message}`).toEqual([false, false]);
  });
}

/**
 * Round 88 (#107): the Setup panel opened off the screen on a phone. At 640 px and less the top bar wraps and the Setup button
 * stands at the left of its row, so a panel anchored at the button's right edge ran past the window's left edge. Now the panel spans
 * the bar like the Load panel; above 640 px it keeps its place under the button, its right edge on the button's.
 */
async function openSetupPanel(page: Page, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  await lightEngine(page);
  await routeOfflineFixtures(page);
  await page.goto('/');
  await loadDockReplay(page, 'gen9doublesou-2693620934', 1);
  const button = page.getByRole('button', { name: 'Setup', exact: true });
  await button.click();
  const panel = page.locator('.ps-setup-panel');
  await expect(panel).toBeVisible();
  // `.ps-btn:hover` lifts the button by 1 px over 0.1 s, and the click leaves the pointer on it: a box read during that
  // transition is up to 1 px off the panel's anchor (0.58 px in the CI run of D9, 0.93 px in the merge of lane H), and one read after
  // it is 1 px off for good. The spec means the layout boxes, so the pointer leaves and the lift settles before the read.
  await page.mouse.move(2, viewport.height - 2);
  await expect(button).toHaveCSS('transform', 'none');
  const boxes = await page.evaluate(() => {
    const rect = (selector: string) => {
      const box = document.querySelector(selector)!.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
    };
    return { panel: rect('.ps-setup-panel'), button: rect('.ps-setup-toggle'), width: document.documentElement.clientWidth };
  });
  return { panel, boxes, message: JSON.stringify(boxes) };
}

for (const width of [390, 640]) {
  test(`${width} px: the open Setup panel lies inside the window with every control visible`, async ({ page }) => {
    test.setTimeout(120_000);
    const { panel, boxes, message } = await openSetupPanel(page, { width, height: 844 });
    expect(boxes.panel.left, `the panel's left edge ${message}`).toBeGreaterThanOrEqual(0);
    expect(boxes.panel.right, `the panel's right edge ${message}`).toBeLessThanOrEqual(boxes.width);
    expect(boxes.panel.top, `the panel hangs under the button ${message}`).toBeGreaterThanOrEqual(boxes.button.bottom);
    await expect(panel.getByRole('checkbox', { name: 'Animate branch turns' })).toBeVisible();
    await expect(panel.getByLabel('Size')).toBeVisible();
    for (const name of ['Edit Player', 'Edit Opp', 'Import/Export Sets']) await expect(panel.getByRole('button', { name, exact: true })).toBeVisible();
    for (const control of await panel.locator('input, select, button').all()) {
      const box = (await control.boundingBox())!;
      expect(box.x, `a control's left edge ${message}`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `a control's right edge ${message}`).toBeLessThanOrEqual(width);
    }
  });
}

for (const width of [641, 1366]) {
  test(`${width} px: the open Setup panel keeps its place under the button`, async ({ page }) => {
    test.setTimeout(120_000);
    const { boxes, message } = await openSetupPanel(page, { width, height: 768 });
    expect(boxes.panel.right, `the panel's right edge is the button's ${message}`).toBeCloseTo(boxes.button.right, 0);
    expect(boxes.panel.top, `the panel hangs 4 px under the button ${message}`).toBeCloseTo(boxes.button.bottom + 4, 0);
    expect(boxes.panel.left, `the panel stays inside the window ${message}`).toBeGreaterThanOrEqual(0);
  });
}
