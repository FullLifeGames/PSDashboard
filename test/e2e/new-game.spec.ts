import { test, expect, type Page } from '@playwright/test';
import { installReplayEmbedCache, routeOfflineFixtures, pickMove } from './helpers';
import { lightEngine } from './dock-helpers';

/**
 * Round 89 (lane H, #105), stage H4: the New game dialog in the browser. A draft-league player pastes two Showdown exports on the
 * start page, picks the format, starts, picks leads (four of six in VGC), plays a turn by hand, reloads the page and opens the game
 * again from the saved list, on its tip. Gen 9 OU and Scarlet/Violet VGC; the engine's turns and the grading are the later stages'.
 */
test.beforeAll(installReplayEmbedCache);

test.beforeEach(async ({ page }) => {
  await lightEngine(page);
  await routeOfflineFixtures(page);
});

const SIX = ['Garchomp', 'Gengar', 'Dragonite', 'Tyranitar', 'Snorlax', 'Starmie'];
const team = (species: string[]) => species.map(name => `${name}\nEVs: 4 HP\n- Protect\n- Earthquake\n- Return\n- Substitute`).join('\n\n');

async function startGame(page: Page, format: { search: string; name: string } | null, names: [string, string]): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'New game' }).click();
  const dialog = page.getByRole('dialog', { name: 'New game' });
  await expect(dialog).toBeVisible();
  if (format) {
    await dialog.getByRole('button', { name: /^Format / }).click();
    await dialog.getByRole('combobox', { name: 'Search formats' }).fill(format.search);
    await dialog.getByRole('option').filter({ has: page.locator('span:first-child', { hasText: new RegExp(`^${format.name.replace(/[[\]()]/g, '\\$&')}$`) }) }).first().click();
  }
  await dialog.getByRole('textbox', { name: 'Player 1 name' }).fill(names[0]);
  await dialog.getByRole('textbox', { name: 'Player 2 name' }).fill(names[1]);
  await dialog.getByRole('textbox', { name: 'Player 1 team' }).fill(team(SIX));
  await dialog.getByRole('textbox', { name: 'Player 2 team' }).fill(team(SIX));
  await expect(dialog.getByText('6 of 6 sets read')).toHaveCount(2);
  await expect(dialog.getByRole('button', { name: 'Start' })).toBeEnabled({ timeout: 60_000 });
  await dialog.getByRole('button', { name: 'Start' }).click();
  await expect(dialog).toBeHidden({ timeout: 60_000 });
}

test('Gen 9 OU: paste, Start at Team Preview, pick leads, play a turn by hand, reload and open the saved game on its tip', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1366, height: 768 });
  await startGame(page, null, ['Tidepool', 'Marrowkid']);
  const bar = page.locator('.ps-topbar');
  await expect(bar.getByText('New game', { exact: true })).toBeVisible();
  await expect(bar.getByText('[Gen 9] OU')).toBeVisible();
  await expect(bar.getByText('Tidepool')).toBeVisible();
  // team preview: the lead picker offers both teams in full
  const lead = page.locator('.ps-lead');
  await expect(lead).toBeVisible({ timeout: 60_000 });
  await expect(lead.locator('.ps-lead-side')).toHaveCount(2);
  await expect(lead.locator('.ps-lead-side').first().locator('.ps-switchbtn')).toHaveCount(6);
  await lead.locator('.ps-lead-side').nth(0).locator('.ps-switchbtn').first().click();
  await lead.locator('.ps-lead-side').nth(1).locator('.ps-switchbtn').first().click();
  await lead.locator('.ps-execute-btn', { hasText: 'Play from turn 0' }).click();
  await expect(page.locator('.ps-dock-chip').first()).toBeVisible({ timeout: 90_000 });
  // turn 1 by hand
  await pickMove(page, 'p1a', 'Earthquake');
  await pickMove(page, 'p2a', 'Protect');
  await page.locator('.ps-dock .ps-execute-btn').click();
  await expect(page.getByText('T2/')).toBeVisible({ timeout: 90_000 });
  // the turn joined the main line: the tip is no variation, so the bar names none and offers no Discard
  await expect(page.getByText(/Branching · Turn/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Discard variation' })).toHaveCount(0);
  await expect(page.getByText('Variation moves')).toHaveCount(0);
  // the game is saved after the finished turn
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('ps-replay-interceptor:games') ?? '[]').length)).toBe(1);

  await page.reload();
  await page.getByRole('button', { name: 'New game' }).click();
  const dialog = page.getByRole('dialog', { name: 'New game' });
  const row = dialog.locator('.ps-newgame-saved-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Tidepool');
  await expect(row).toContainText('1 turn played');
  await row.getByRole('button', { name: 'Open' }).click();
  await expect(dialog).toBeHidden();
  await expect(bar.getByText('New game', { exact: true })).toBeVisible();
  await expect(page.getByText('T2/')).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('.ps-dock-chip').first()).toBeVisible({ timeout: 90_000 });
});

test('Scarlet/Violet VGC: the picker asks for four of six, the first two lead, the bench holds the two brought; a turn by hand joins the main line', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1366, height: 768 });
  await startGame(page, { search: 'vgc 2025', name: '[Gen 9] VGC 2025 Reg I' }, ['Lucario Lab', 'Ferrothorn Fan']);
  const bar = page.locator('.ps-topbar');
  await expect(bar.getByText('[Gen 9] VGC 2025 Reg I')).toBeVisible();
  const lead = page.locator('.ps-lead');
  await expect(lead).toBeVisible({ timeout: 60_000 });
  await expect(lead).toContainText(/pick the 4 each side brings/);
  for (const side of [0, 1]) {
    const tiles = lead.locator('.ps-lead-side').nth(side).locator('.ps-switchbtn');
    await expect(tiles).toHaveCount(6);
    for (let pick = 0; pick < 4; pick += 1) await tiles.nth(pick).click();
  }
  await lead.locator('.ps-execute-btn', { hasText: 'Play from turn 0' }).click();
  await expect(page.locator('.ps-dock-chip').first()).toBeVisible({ timeout: 90_000 });
  for (const slot of ['p1a', 'p1b', 'p2a', 'p2b'] as const) await pickMove(page, slot, 'Protect');
  await page.locator('.ps-dock .ps-execute-btn').click();
  await expect(page.getByText('T2/')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole('button', { name: 'Discard variation' })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('ps-replay-interceptor:games') ?? '[]')[0]?.formatName)).toBe('[Gen 9] VGC 2025 Reg I');
});
