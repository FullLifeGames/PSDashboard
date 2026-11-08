import { test, expect } from '@playwright/test';
import { installReplayEmbedCache, routeOfflineFixtures } from './helpers';
import { failOnResizeLoops, lightEngine, loadDockReplay } from './dock-helpers';

/**
 * Round 84 (turn dock), step A7b, ruling 9a: the right column ends on the line of the dock's foot. Evaluation and Play out keep
 * their height at the top; the Battle Statistics panel takes the rest as a closed panel whose list scrolls inside it. At 1366 x 768
 * and 1707 x 860 (the user's 2560 x 1440 at 150 %, in CSS pixels) the panel's bottom lies within 2 px of the dock's bottom, the
 * column itself does not scroll while Evaluation fits, and the list is the part that scrolls and fades. The shared-branch view
 * uses the same column and keeps its panel.
 */
test.beforeAll(installReplayEmbedCache);
failOnResizeLoops(test);

test.beforeEach(async ({ page }) => {
  await lightEngine(page);
  await routeOfflineFixtures(page);
});

for (const viewport of [{ width: 1366, height: 768 }, { width: 1707, height: 860 }]) {
  test(`the statistics panel ends on the dock's foot at ${viewport.width} x ${viewport.height}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(viewport);
    await page.goto('/');
    await loadDockReplay(page, 'gen9doublesou-2693620934', 5);
    const panel = page.locator('.ps-main-right > .ps-stats-panel');
    await expect(panel).toBeVisible();
    const facts = await page.evaluate(() => {
      const right = document.querySelector('.ps-main-right') as HTMLElement;
      const panelBox = (document.querySelector('.ps-main-right > .ps-stats-panel') as HTMLElement).getBoundingClientRect();
      const dockBox = (document.querySelector('.ps-dock') as HTMLElement).getBoundingClientRect();
      const rightBox = right.getBoundingClientRect();
      const list = document.querySelector('.ps-stats-panel > .ps-stats-grid') as HTMLElement;
      const head = (document.querySelector('.ps-main-right') as HTMLElement).firstElementChild!.getBoundingClientRect();
      return {
        panelBottom: panelBox.bottom, dockBottom: dockBox.bottom, rightBottom: rightBox.bottom,
        columnScrolls: right.scrollHeight > right.clientHeight, columnScrollTop: right.scrollTop,
        listScrolls: list.scrollHeight > list.clientHeight, listMore: list.getAttribute('data-more'), headTop: head.top, panelTop: panelBox.top,
      };
    });
    expect(Math.abs(facts.panelBottom - facts.dockBottom), 'panel bottom against the dock bottom').toBeLessThanOrEqual(2);
    expect(Math.abs(facts.rightBottom - facts.dockBottom), 'column bottom against the dock bottom').toBeLessThanOrEqual(2);
    expect(facts.columnScrollTop, 'scrollTop of the right column').toBe(0);
    expect(facts.columnScrolls, 'the column does not scroll while Evaluation fits').toBe(false);
    expect(facts.panelTop, 'the panel stands under Evaluation').toBeGreaterThan(facts.headTop);
    // The list is what scrolls, and it fades while more follows.
    expect(facts.listScrolls, 'the statistics list is taller than its room').toBe(true);
    expect(facts.listMore).toBe('true');
    const list = page.locator('.ps-stats-panel > .ps-stats-grid');
    await list.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(list).not.toHaveAttribute('data-more', 'true');
  });
}

/**
 * Round 88 (T346, #82): a window too short for Evaluation and the statistics together scrolls the whole column; the statistics
 * panel never shrinks to a strip. A tall Evaluation panel (a stand-in height of 780 px, what the ranked choices of a doubles or
 * VGC turn take) is held at four window sizes that cross both root scales (1920 x 1000 reads 100 %, 1920 x 1050 reads 125 %).
 * With the column scrolled to its end, the first Pokemon entry lies whole inside the list and inside the column, above the
 * fade, and the wheel moves the list.
 */
const TALL_EVALUATION = 780;
const SCENES: Array<{ name: string; id: string | null; turn: number }> = [
  { name: 'singles', id: null, turn: 2 },
  { name: 'doubles', id: 'gen9doublesou-2693620934', turn: 5 },
  { name: 'VGC Scarlet/Violet', id: 'dock-vgcregi-2573391549', turn: 4 },
  { name: 'VGC Champions', id: 'dock-championsvgc-2625939941', turn: 4 },
];
const WINDOWS = [{ width: 1366, height: 768 }, { width: 1707, height: 860 }, { width: 1920, height: 1000 }, { width: 1920, height: 1050 }];

for (const scene of SCENES) {
  test(`the statistics keep a readable height under a tall Evaluation panel (${scene.name})`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize(WINDOWS[0]);
    await page.goto('/');
    if (scene.id) await loadDockReplay(page, scene.id, scene.turn);
    else {
      await page.locator('button', { hasText: 'Load' }).click();
      await expect(page.locator('.ps-branch-bar input[type="range"]')).toBeVisible({ timeout: 30_000 });
      await page.locator('.ps-branch-bar input[type="range"]').fill(String(scene.turn));
      await expect(page.getByText(`T${scene.turn}/`)).toBeVisible();
    }
    await expect(page.locator('.ps-main-right > .ps-stats-panel .ps-stats-pokemon').first()).toBeVisible({ timeout: 30_000 });
    await page.addStyleTag({ content: `.ps-main-right > .ps-eval-panel { min-height: ${TALL_EVALUATION}px; }` });
    for (const viewport of WINDOWS) {
      await page.setViewportSize(viewport);
      const facts = await page.evaluate(async () => {
        const right = document.querySelector('.ps-main-right') as HTMLElement;
        const list = document.querySelector('.ps-stats-panel > .ps-stats-grid') as HTMLElement;
        list.scrollTop = 0;
        right.scrollTop = right.scrollHeight;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await new Promise(resolve => setTimeout(resolve, 300));
        const zoom = Number(getComputedStyle(document.documentElement).zoom) || 1;
        const entry = list.querySelector('.ps-stats-pokemon') as HTMLElement;
        const entryBox = entry.getBoundingClientRect();
        const listBox = list.getBoundingClientRect();
        const rightBox = right.getBoundingClientRect();
        return {
          zoom, entryHeight: entryBox.height, listHeight: listBox.height,
          entryTopInList: entryBox.top - listBox.top, entryBottomInList: entryBox.bottom - listBox.top,
          entryBottomInColumn: rightBox.bottom - entryBox.bottom, entryTopInColumn: entryBox.top - rightBox.top,
          more: list.getAttribute('data-more'), listScrolls: list.scrollHeight > list.clientHeight + 1,
          columnScrolls: right.scrollHeight > right.clientHeight + 1,
        };
      });
      const label = `${scene.name} at ${viewport.width} x ${viewport.height} (zoom ${facts.zoom})`;
      expect(facts.columnScrolls, `${label}: the tall Evaluation panel makes the column scroll`).toBe(true);
      expect(facts.entryTopInList, `${label}: the first entry starts inside the list`).toBeGreaterThanOrEqual(-1);
      const fade = facts.more === 'true' ? 36 * facts.zoom : 0;
      expect(facts.entryBottomInList, `${label}: the first entry ends above the list's end and the fade`).toBeLessThanOrEqual(facts.listHeight - fade + 1);
      expect(facts.entryBottomInColumn, `${label}: the first entry lies inside the column`).toBeGreaterThanOrEqual(-1);
      expect(facts.entryTopInColumn, `${label}: the first entry starts inside the column`).toBeGreaterThanOrEqual(-1);
      if (facts.listScrolls) {
        const list = page.locator('.ps-stats-panel > .ps-stats-grid');
        await list.hover();
        await page.mouse.wheel(0, 120);
        await expect.poll(() => list.evaluate(element => element.scrollTop), `${label}: the wheel scrolls the list`).toBeGreaterThan(0);
      }
    }
  });
}
