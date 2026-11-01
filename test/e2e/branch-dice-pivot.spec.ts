import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { emptySmogon, routeSmogon } from './smogon-routes';
import { fixturePath, installReplayEmbedCache, routeOfflineFixtures, waitForExactPickers } from './helpers';

/**
 * Round 82, the user's test of 01.11.2026: the draft replay gen9draft-2058494320 viewed at turn 1, Advanced, U-turn against
 * Chilly Reception, Execute from the viewed position. A branch's first turn plays through the dice module. While Execute waited
 * for the turn, the panel asked for the turn's dice on a copy of the paused battle, and the copy's refusal reached the live
 * error log: the variation was undone with "Can't move: You need a switch response" and no switch-in could be picked.
 */
test.beforeAll(installReplayEmbedCache);

test('U-turn against Chilly Reception from the viewed turn 1 in Advanced: both sides send their switch-in', async ({ page }) => {
  test.setTimeout(240_000);
  const draftReplay = readFileSync(fixturePath('draft-replay.json'), 'utf-8');
  await routeOfflineFixtures(page);
  await page.route('**/replay.pokemonshowdown.com/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: draftReplay }));
  await page.goto('/');
  await routeSmogon(page, emptySmogon);
  await page.locator('button', { hasText: 'Load' }).click();
  await expect(page.locator('.ps-branch-bar input[type="range"]')).toBeVisible({ timeout: 30_000 });
  await page.locator('.ps-branch-bar input[type="range"]').fill('1');
  await expect(page.getByText('T1/')).toBeVisible();
  await page.locator('button', { hasText: 'Advanced' }).click();
  await waitForExactPickers(page);

  const p1 = page.locator('.ps-branch-side-column').first();
  const p2 = page.locator('.ps-branch-side-column').nth(1);
  await p1.locator('.ps-movebtn', { hasText: 'U-turn' }).click();
  await p2.locator('.ps-movebtn', { hasText: 'Chilly Reception' }).click();
  await page.locator('.ps-execute-btn').click();

  const history = page.locator('.ps-panel', { hasText: 'Variation moves' });
  for (const side of ['P1', 'P2']) {
    const forced = page.locator('.ps-side-controls', { has: page.locator('.ps-force-switch-note') }).first();
    await forced.locator('.ps-switchbtn:enabled').first().click({ timeout: 60_000 });
    await expect(history).toContainText(`forced replacement (${side})`, { timeout: 30_000 });
  }
  await expect(page.getByText('You need a switch response')).toHaveCount(0);
});
