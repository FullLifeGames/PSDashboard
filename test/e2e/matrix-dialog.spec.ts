import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { test, expect, type Locator, type Page } from '@playwright/test';
import type { ReplayData } from '@fulllifegames/replay-core';
import { installReplayEmbedCache, routeOfflineFixtures } from './helpers';
import { variationPanel } from './dock-helpers';

/**
 * The turn card's "Open matrix" button opens the turn's matrix as a dialog. One test per game type, singles (Gen 6 OU
 * 655336) and Doubles OU (912884), both on turn 8: at 1400 px the dialog fits the window, names the played and the engine choices in
 * words and plays a clicked cell out as a variation; at 390 px it fits the screen and the page itself does not scroll sideways, the
 * wide table scrolls inside the dialog. Escape closes it and hands the focus back to the button.
 */
const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(here, '../../packages/eval-engine/test/fixtures', `${name}.json`), 'utf-8')) as ReplayData;

test.beforeAll(installReplayEmbedCache);

const GAMES = [
  { kind: 'singles (Gen 6 OU)', id: 'smogtours-gen6ou-655336', turn: 8 },
  { kind: 'Doubles OU', id: 'smogtours-gen9doublesou-912884', turn: 8 },
];

async function openPage(page: Page, replay: ReplayData): Promise<void> {
  page.setDefaultTimeout(30_000);
  await routeOfflineFixtures(page);
  await page.addInitScript(() => {
    localStorage.setItem('ps-replay-interceptor:eval-pool', '2');
    localStorage.setItem('ps-replay-interceptor:eval-prefs', JSON.stringify({ depth: 1, samples: 1, mode: 'matrix', auto: false, tera: 'auto' }));
  });
  await page.goto('/');
  await page.route('**/replay.pokemonshowdown.com/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(replay) }));
  await page.locator('input[type="text"]').first().fill(replay.id);
  await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
  await expect(page.getByText(replay.players[0], { exact: true }).first()).toBeVisible({ timeout: 30_000 });
}

/** The panel can land on the game report right after a search; a click on the turn's column of the graph opens the card again. */
async function settleOnTurn(page: Page, panel: Locator, turn: number): Promise<void> {
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    const column = panel.locator(`svg rect[data-turn="${turn}"]`).first();
    if (await column.count() > 0) await column.click({ force: true, timeout: 5000 }).catch(() => {});
    if (await panel.locator('.ps-eval-analysis').getByRole('button', { name: 'Open matrix' }).isVisible()) {
      await page.waitForTimeout(1500);
      if (await panel.locator('.ps-eval-analysis').getByRole('button', { name: 'Open matrix' }).isVisible()) return;
    }
    await page.waitForTimeout(2000);
  }
  throw new Error(`the card of turn ${turn} showed no Open matrix button within 150 s`);
}

/** The dialog sits inside the window, and the page behind it does not scroll sideways. */
async function expectFits(page: Page, dialog: Locator): Promise<void> {
  const box = (await dialog.boundingBox())!;
  const view = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(view.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(view.height + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

for (const game of GAMES) {
  test(`${game.kind}: Open matrix on the turn card shows the marked matrix, fits both widths and plays a cell out`, async ({ page }) => {
    test.setTimeout(360_000);
    const replay = fixture(game.id);
    await page.setViewportSize({ width: 1400, height: 900 });
    await openPage(page, replay);
    const panel = page.locator('.ps-main-right .ps-eval-panel');
    await page.locator('input[type="range"]').fill(String(game.turn));
    const analyze = panel.getByRole('button', { name: /^Analyze this position/ });
    await expect(analyze).toBeEnabled({ timeout: 60_000 });
    await analyze.click();
    await settleOnTurn(page, panel, game.turn);

    // the overview's own toggle stays
    await expect(panel.locator('button.ps-eval-matrix-toggle')).toBeVisible();

    const button = panel.locator('.ps-eval-analysis').getByRole('button', { name: 'Open matrix' });
    await button.click();
    const dialog = page.getByRole('dialog', { name: new RegExp(`^Turn ${game.turn} · .+'s choices against .+'s$`) });
    await expect(dialog).toBeVisible();
    const table = dialog.locator('table');
    await expect(table.locator('td').first()).toContainText(/\d+%/);
    // the marks are words; the engine's rows and columns carry one, and every header shows its weight
    await expect(table.getByText('engine', { exact: true }).first()).toBeVisible();
    expect(await table.getByText('played', { exact: true }).count()).toBeGreaterThanOrEqual(1);
    const headers = await table.locator('th').count();
    expect(headers).toBeGreaterThan(2);
    expect(await table.locator('th', { hasText: /\d+%/ }).count()).toBe(headers - 1);
    await expectFits(page, dialog);

    // a narrow screen: the dialog fits, the table scrolls inside it
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(dialog).toBeVisible();
    await expectFits(page, dialog);
    const scroller = table.locator('xpath=..');
    if (game.kind === 'Doubles OU') {
      expect(await scroller.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
      const corner = table.locator('th').first();
      const before = (await corner.boundingBox())!.x;
      await scroller.evaluate(node => { node.scrollLeft = 200; });
      expect(Math.abs((await corner.boundingBox())!.x - before)).toBeLessThan(2);
    }
    await page.setViewportSize({ width: 1400, height: 900 });

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(button).toBeFocused();

    await button.click();
    await expect(dialog).toBeVisible();
    await table.locator('td button').first().click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(/Variation tip: Turn/)).toBeVisible({ timeout: 90_000 });
    await expect(variationPanel(page)).toContainText(`Turn ${game.turn}`, { timeout: 90_000 });
  });
}
