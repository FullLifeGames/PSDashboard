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
