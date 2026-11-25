import { test, expect, type Page } from '@playwright/test';
import { dockReplays, installReplayEmbedCache, routeOfflineFixtures } from './helpers';
import { failOnResizeLoops, lightEngine, loadDockReplay } from './dock-helpers';

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
    expect(Math.max(...facts.tops), `the bar's children share one line ${message}`).toBeLessThan(Math.min(...facts.bottoms));
    if (facts.tagClipped) expect(facts.namesClipped, `the names stay whole while the tag clips ${message}`).toEqual([false, false]);
  });
}

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
  // `.ps-btn:hover` lifts the button 1 px over 0.1 s, and the click leaves the pointer on it:
  // the pointer leaves and the lift settles before the layout boxes are read.
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
    await expect(panel.getByRole('checkbox', { name: 'Opponent reads my move' })).toBeVisible();
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

// The status text is set to the long form before the read (the fixture's branch reads a short turn); no render follows.
test('390 px: the branch status, Game, Setup and the support links do not overlap', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await lightEngine(page);
  await routeOfflineFixtures(page);
  await page.goto('/');
  await loadDockReplay(page, 'gen9doublesou-2693620934', 1);
  await page.locator('.ps-execute-btn').click();
  const status = page.locator('.ps-topbar-actions > span', { hasText: /^Variation tip/ });
  await expect(status).toBeVisible({ timeout: 90_000 });
  await status.evaluate(element => { element.textContent = 'Variation tip: Turn 33'; });
  const boxes = await page.evaluate(() => {
    const rect = (element: Element) => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, text: (element.textContent ?? '').trim().slice(0, 24) };
    };
    const bar = document.querySelector('.ps-topbar')!;
    return [
      ...bar.querySelectorAll('.ps-topbar-actions > span, .ps-topbar-actions button'),
      ...bar.querySelectorAll('.ps-support-links > button, .ps-support-links > a'),
    ].map(rect);
  });
  expect(boxes.length, JSON.stringify(boxes)).toBeGreaterThanOrEqual(5);
  for (let a = 0; a < boxes.length; a++) {
    for (let b = a + 1; b < boxes.length; b++) {
      const across = Math.min(boxes[a].right, boxes[b].right) - Math.max(boxes[a].left, boxes[b].left);
      const down = Math.min(boxes[a].bottom, boxes[b].bottom) - Math.max(boxes[a].top, boxes[b].top);
      expect(across > 1 && down > 1, `"${boxes[a].text}" and "${boxes[b].text}" overlap ${JSON.stringify(boxes)}`).toBe(false);
    }
  }
  for (const box of boxes) expect(box.bottom - box.top, `"${box.text}" stays on one line ${JSON.stringify(boxes)}`).toBeLessThan(30);
});
