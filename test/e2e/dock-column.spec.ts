import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { emptySmogon, routeSmogon } from './smogon-routes';
import { fixturePath, installReplayEmbedCache, pickMove, routeOfflineFixtures, waitForExactPickers } from './helpers';
import { TASK_VIEWPORT, failOnResizeLoops, lightEngine, loadDockReplay, openVariationHistory, pinUiScale, variationPanel } from './dock-helpers';

test.beforeAll(installReplayEmbedCache);
failOnResizeLoops(test);
test.use({ viewport: { width: 2560, height: 1290 } });

test.beforeEach(async ({ page }) => {
  await lightEngine(page);
  // Auto would take 150 % at this window; the geometry here is the app's own 100 %.
  await pinUiScale(page, 1);
  await routeOfflineFixtures(page);
});

interface Column { gap: number; overlap: number; scrollable: boolean }

async function columnGeometry(page: Page): Promise<Column> {
  return page.evaluate(() => {
    const left = document.querySelector('.ps-main-left') as HTMLElement;
    const toggle = document.querySelector('.ps-dock-log') as HTMLElement;
    const dock = document.querySelector('.ps-dock') as HTMLElement;
    const above = toggle.previousElementSibling as HTMLElement;
    left.scrollTop = 0;
    const gap = toggle.getBoundingClientRect().top - above.getBoundingClientRect().bottom;
    left.scrollTop = left.scrollHeight;
    const overlap = Math.max(
      above.getBoundingClientRect().bottom - toggle.getBoundingClientRect().top,
      toggle.getBoundingClientRect().bottom - dock.getBoundingClientRect().top,
    );
    return { gap, overlap, scrollable: left.scrollHeight > left.clientHeight };
  });
}

function expectFollowsContent(column: Column, where: string): void {
  expect(column.gap, `${where}: the toggle stands within 16 px of what is above it`).toBeLessThanOrEqual(16);
  expect(column.gap, `${where}: the toggle does not lie over what is above it`).toBeGreaterThanOrEqual(-1);
  expect(column.overlap, `${where}: with the column scrolled to its end the dock lies over nothing`).toBeLessThanOrEqual(1);
}

test('a replay turn: the log toggle and the dock follow the timeline directly and lie over nothing', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await loadDockReplay(page, 'gen9doublesou-2693620934', 5);
  const column = await columnGeometry(page);
  expect(column.scrollable, 'at 2560 x 1290 the column fits the window').toBe(false);
  expectFollowsContent(column, 'replay turn');
  const dock = (await page.locator('.ps-dock').boundingBox())!;
  expect(dock.y + dock.height, 'the dock ends well above the window\'s foot').toBeLessThan(1290 - 100);
});

test('a variation\'s forced replacement with the history panel closed and open: no gap, no overlap', async ({ page }) => {
  test.setTimeout(240_000);
  const draftReplay = readFileSync(fixturePath('draft-replay.json'), 'utf-8');
  await page.route('**/replay.pokemonshowdown.com/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: draftReplay }));
  await page.goto('/');
  await routeSmogon(page, emptySmogon);
  await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
  await expect(page.locator('.ps-branch-bar input[type="range"]')).toBeVisible({ timeout: 30_000 });
  await page.locator('.ps-branch-bar input[type="range"]').fill('1');
  await expect(page.getByText('T1/')).toBeVisible();
  await waitForExactPickers(page);
  await pickMove(page, 'p1a', 'U-turn');
  await pickMove(page, 'p2a', 'Chilly Reception');
  await page.locator('.ps-execute-btn').click();

  await expect(page.locator('.ps-force-switch-note').first()).toBeVisible({ timeout: 60_000 });
  await expect(variationPanel(page)).toBeVisible();
  await expect(page.getByText('Variation result').first()).toBeHidden();
  expectFollowsContent(await columnGeometry(page), 'forced replacement, history closed');
  await openVariationHistory(page);
  await expect(page.getByText('Variation result').first()).toBeVisible();
  expectFollowsContent(await columnGeometry(page), 'forced replacement');
  const strip = (await page.locator('.ps-dock-status').boundingBox())!;
  const history = (await page.locator('.ps-panel', { hasText: 'Variation moves' }).boundingBox())!;
  expect(strip.y, 'the status strip starts below the history panel').toBeGreaterThanOrEqual(history.y + history.height - 1);
});

test('a variation at 1366 x 768: Save Branch and Copy Share Link stand above the dock, and the link shows with the history closed', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize(TASK_VIEWPORT);
  const draftReplay = readFileSync(fixturePath('draft-replay.json'), 'utf-8');
  await page.route('**/replay.pokemonshowdown.com/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: draftReplay }));
  await page.goto('/');
  await routeSmogon(page, emptySmogon);
  await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
  await expect(page.locator('.ps-branch-bar input[type="range"]')).toBeVisible({ timeout: 30_000 });
  await page.locator('.ps-branch-bar input[type="range"]').fill('1');
  await expect(page.getByText('T1/')).toBeVisible();
  await waitForExactPickers(page);
  await pickMove(page, 'p1a', 'U-turn');
  await pickMove(page, 'p2a', 'Chilly Reception');
  await page.locator('.ps-execute-btn').click();
  await expect(page.locator('.ps-force-switch-note').first()).toBeVisible({ timeout: 60_000 });

  const toggle = variationPanel(page).getByRole('button', { name: /Variation moves/ });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  const save = page.getByRole('button', { name: 'Save Branch' });
  const share = page.getByRole('button', { name: 'Copy Share Link' });
  await expect(save).toBeVisible();
  await expect(share).toBeVisible();
  const dock = (await page.locator('.ps-dock').boundingBox())!;
  for (const button of [save, share]) {
    const box = (await button.boundingBox())!;
    expect(box.y + box.height, 'the button ends above the dock').toBeLessThanOrEqual(dock.y + 1);
  }
  await share.click();
  await expect(page.locator('input[aria-label="Branch share link"]')).toHaveValue(/#branch=/);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});
