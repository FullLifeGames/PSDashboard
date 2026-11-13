import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { fixturePath, installReplayEmbedCache, openTrayMore, pickMove, routeOfflineFixtures, waitForExactPickers } from './helpers';
import { branchFrameEntries, openVariationHistory, variationPanel } from './dock-helpers';

/**
 * Round 89 (#114, the user's ruling 31 of 13.11.2026): a move whose later hits roll accuracy (Triple Axel, Population Bomb) shows
 * one "Hits" row of the counts 1 to N under its "Hit" row. The user sets a count, Execute plays it, and the branch frame, the
 * history row and the mark in the frame say it once.
 * - Singles, Scarlet/Violet OU smogtours-gen9ou-752301, turn 12: "carry me"'s Triple Axel knocked Glimmora out on hit 2. "1 hit"
 *   leaves Glimmora standing.
 * - VGC, Scarlet/Violet gen9vgc2025regh-2461544957, turn 6: Maushold's Population Bomb stopped after one hit on Dondozo (17/100
 *   left, the second hit missed). "5 hits" plays five hits, and Dondozo faints on the fifth (the seed's rolls).
 */
test.beforeAll(installReplayEmbedCache);

async function load(page: Page, file: string, turn: number) {
  const body = readFileSync(fixturePath(file), 'utf-8');
  const replay = JSON.parse(body) as { id: string };
  await routeOfflineFixtures(page);
  await page.route('**/replay.pokemonshowdown.com/**', route => route.fulfill({ status: 200, contentType: 'application/json', body }));
  await page.goto('/');
  await page.locator('input[type="text"]').first().fill(replay.id);
  await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).first().click();
  await expect(page.locator('.ps-branch-bar input[type="range"]')).toBeVisible({ timeout: 60_000 });
  await waitForExactPickers(page, turn);
}

const hitsRow = (tray: ReturnType<Page['locator']>) => tray.getByRole('group', { name: 'Hits', exact: true });

test('singles: "1 hit" for Triple Axel plays one hit and Glimmora stands', async ({ page }) => {
  test.setTimeout(240_000);
  await load(page, 'interlude-singles-752301.json', 12);
  await pickMove(page, 'p2a', 'Triple Axel');
  const tray = await openTrayMore(page, 'p2a');
  const row = hitsRow(tray);
  await expect(row).toBeVisible({ timeout: 30_000 });
  // one row of the counts 1 to 3, and the log's count (hit 2 landed, Glimmora fainted on it) marked
  await expect(row.getByRole('button')).toHaveText(['1 hit', '2 hits · log', '3 hits']);
  await expect(tray.getByRole('group', { name: 'Hit', exact: true })).toBeVisible();
  await row.getByRole('button', { name: '1 hit', exact: true }).click();
  await expect(row.getByRole('button', { name: '1 hit', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.ps-execute-btn').click();
  await expect(variationPanel(page)).toContainText('Turn 12', { timeout: 90_000 });

  const entries = await branchFrameEntries(page);
  await expect.poll(async () => (await entries()).some(entry => entry === 'Forced: Triple Axel 1 hit'), { timeout: 60_000 }).toBe(true);
  const shown = await entries();
  expect(shown.filter(entry => entry.startsWith('Forced: Triple Axel 1 hit'))).toHaveLength(1);
  const afterMark = shown.slice(shown.indexOf('Forced: Triple Axel 1 hit'));
  expect(afterMark.some(entry => /Glimmora fainted/.test(entry))).toBe(false);
  expect(afterMark.some(entry => /Hit \d+ time/.test(entry))).toBe(false);
  await openVariationHistory(page);
  await expect(page.getByRole('group', { name: 'Forced dice' })).toContainText('Triple Axel: 1 hit');
});

test('VGC: "5 hits" for Population Bomb plays five hits and Dondozo faints', async ({ page }) => {
  test.setTimeout(240_000);
  await load(page, 'dice-hits-vgc-2461544957.json', 6);
  await pickMove(page, 'p2b', 'Population Bomb');
  const tray = await openTrayMore(page, 'p2b');
  const row = hitsRow(tray);
  await expect(row).toBeVisible({ timeout: 30_000 });
  // ten counts in one row; the log shows one hit
  await expect(row.getByRole('button')).toHaveCount(10);
  await expect(row.getByRole('button').first()).toHaveText('1 hit · log');
  await row.getByRole('button', { name: '5 hits', exact: true }).click();
  await expect(row.getByRole('button', { name: '5 hits', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.ps-execute-btn').click();
  await expect(variationPanel(page)).toContainText('Turn 6', { timeout: 90_000 });

  const entries = await branchFrameEntries(page);
  await expect.poll(async () => (await entries()).some(entry => entry === 'Forced: Population Bomb 5 hits'), { timeout: 60_000 }).toBe(true);
  const shown = await entries();
  const afterMark = shown.slice(shown.indexOf('Forced: Population Bomb 5 hits'));
  // the mark stands before hit 2 (the first hit's damage line is above it)
  expect(afterMark.filter(entry => /^\(Dondozo lost/.test(entry))).toHaveLength(4);
  expect(afterMark.some(entry => /Dondozo fainted/.test(entry))).toBe(true);
  expect(afterMark.some(entry => /The Pokémon was hit 5 times!/.test(entry))).toBe(true);
  expect(shown.some(entry => /had no effect/.test(entry))).toBe(false);
  await openVariationHistory(page);
  await expect(page.getByRole('group', { name: 'Forced dice' })).toContainText('Population Bomb: 5 hits');
});

// Round 89 (F5, the wave-tester's finding 1): Glimmora's Toxic Debris answers hit 1 and Glimmora faints on hit 2, so a forced
// "3 hits" plays two. The frame line reads what the game did, whole, and the history row says how many hits played.
test('singles: "3 hits" on Glimmora reads "2 played" with the whole reason, not Toxic Debris and a cut at the quote', async ({ page }) => {
  test.setTimeout(240_000);
  await load(page, 'interlude-singles-752301.json', 12);
  await pickMove(page, 'p2a', 'Triple Axel');
  const tray = await openTrayMore(page, 'p2a');
  const row = hitsRow(tray);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.getByRole('button', { name: '3 hits', exact: true }).click();
  await page.locator('.ps-execute-btn').click();
  await expect(variationPanel(page)).toContainText('Turn 12', { timeout: 90_000 });

  const entries = await branchFrameEntries(page);
  const line = 'Forced 3 hits, 2 played: Triple Axel ended after 2 hits, so hit 3 was never rolled';
  await expect.poll(async () => (await entries()).some(entry => entry === line), { timeout: 60_000 }).toBe(true);
  const shown = await entries();
  expect(shown.some(entry => /Toxic Debris"|the protocol shows/.test(entry))).toBe(false);
  // the line stands next to the game's own count of two hits
  expect(shown.indexOf(line) - shown.findIndex(entry => /was hit 2 times/.test(entry))).toBeLessThanOrEqual(2);
  await openVariationHistory(page);
  await expect(page.getByRole('group', { name: 'Forced dice' })).toContainText('Triple Axel: 3 hits (2 played)');
});
