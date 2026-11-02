import { test, expect, type Page } from '@playwright/test';
import { installReplayEmbedCache, routeOfflineFixtures } from './helpers';
import { lightEngine, loadDockReplay } from './dock-helpers';

/**
 * Round 84 (turn dock), step A7b, ruling 12b: the lead picker at turn 0 wears the dock's look and stands where the dock stands.
 * Doubles OU fixture. At 1366 x 768: it is the last child of the left column, directly under the timeline (nothing but the column's
 * flow between them), P1 stands above P2, Start sits in the bar's last column at the width of Execute's column, and picking a lead
 * changes no tile's box (the order mark stands in the flag row). At 390 x 844 the fixed bar keeps to 60 % of the window, the page
 * does not scroll sideways, and the picks still start the game.
 */
test.beforeAll(installReplayEmbedCache);

test.beforeEach(async ({ page }) => {
  await lightEngine(page);
  await routeOfflineFixtures(page);
});

async function openTurnZero(page: Page): Promise<void> {
  await page.goto('/');
  await loadDockReplay(page, 'gen9doublesou-2693620934', 5);
  await page.locator('.ps-branch-bar button[title^="Turn 0"]').click();
  await expect(page.locator('.ps-lead')).toBeVisible({ timeout: 30_000 });
}

test('the picker stands under the timeline in the dock look, and a pick moves no tile', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1366, height: 768 });
  await openTurnZero(page);
  const lead = page.locator('.ps-lead');
  expect(await page.locator('.ps-main-left').evaluate(left => left.lastElementChild?.classList.contains('ps-lead')), 'the last child of the column').toBe(true);
  const facts = await page.evaluate(() => {
    const root = document.querySelector('.ps-lead') as HTMLElement;
    const sides = [...root.querySelectorAll('.ps-lead-side')].map(side => side.getBoundingClientRect());
    const start = root.querySelector('.ps-dock-bar > .ps-execute-btn') as HTMLElement;
    const above = root.previousElementSibling!.getBoundingClientRect();
    return { top: root.getBoundingClientRect().top, aboveBottom: above.bottom, p1Bottom: sides[0].bottom, p2Top: sides[1].top, startWidth: start.getBoundingClientRect().width, sides: sides.length };
  });
  expect(facts.sides).toBe(2);
  expect(facts.p2Top, 'P2 stands below P1').toBeGreaterThanOrEqual(facts.p1Bottom);
  expect(facts.top - facts.aboveBottom, 'the picker follows the content directly').toBeLessThanOrEqual(16);
  expect(Math.round(facts.startWidth), 'Start fills Execute\'s column').toBe(150);

  const tiles = lead.locator('.ps-lead-side').first().locator('.ps-switchbtn');
  const before = await Promise.all((await tiles.all()).map(tile => tile.boundingBox()));
  await lead.locator('.ps-lead-side').first().locator('.ps-switchbtn:not(.ps-switchbtn-selected)').first().click();
  const after = await Promise.all((await tiles.all()).map(tile => tile.boundingBox()));
  expect(after.map(box => [box!.x, box!.y, box!.width, box!.height]), 'no tile changes its box when a pick lands').toEqual(before.map(box => [box!.x, box!.y, box!.width, box!.height]));
});

test('on a phone the fixed bar scrolls inside, the page does not scroll sideways, and Start starts the game', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await openTurnZero(page);
  const facts = await page.evaluate(() => {
    const bar = document.querySelector('.ps-lead .ps-dock-bar') as HTMLElement;
    return { barHeight: bar.getBoundingClientRect().height, innerHeight: window.innerHeight, scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth };
  });
  expect(facts.barHeight, 'the bar keeps to 60 % of the window').toBeLessThanOrEqual(facts.innerHeight * 0.6 + 1);
  expect(facts.scrollWidth, 'no horizontal scroll').toBeLessThanOrEqual(facts.clientWidth);
  await page.locator('.ps-lead .ps-execute-btn', { hasText: 'Play from turn 0' }).click();
  await expect(page.locator('.ps-dock-chip').first()).toBeVisible({ timeout: 60_000 });
});
