import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { emptySmogon, routeSmogon } from './smogon-routes';
import { dockChip, fixturePath, installReplayEmbedCache, pickMove, routeOfflineFixtures, waitForExactPickers } from './helpers';
import { lightEngine } from './dock-helpers';

/**
 * Round 84 (turn dock), step A7a, ruling 2a: a forced replacement gets the engine's choice like any slot. The draft replay of the
 * pivot spec (U-turn against Chilly Reception at turn 1) ends the turn with a forced replacement of P1, then of P2 (singles). At
 * each the chip reads the engine's switch with the mark "engine", Execute appears and sends it; a bench click would send a body in
 * at once, as before (`pickForcedReplacement`, held by the pivot spec).
 */
test.beforeAll(installReplayEmbedCache);

test('a forced replacement: the engine fills the slot, Execute sends it, on both sides in turn', async ({ page }) => {
  test.setTimeout(420_000);
  const draftReplay = readFileSync(fixturePath('draft-replay.json'), 'utf-8');
  await lightEngine(page);
  await routeOfflineFixtures(page);
  await page.route('**/replay.pokemonshowdown.com/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: draftReplay }));
  await page.goto('/');
  await routeSmogon(page, emptySmogon);
  await page.locator('button', { hasText: 'Load' }).click();
  await expect(page.locator('.ps-branch-bar input[type="range"]')).toBeVisible({ timeout: 30_000 });
  await page.locator('.ps-branch-bar input[type="range"]').fill('1');
  await expect(page.getByText('T1/')).toBeVisible();
  await waitForExactPickers(page);
  await pickMove(page, 'p1a', 'U-turn');
  await pickMove(page, 'p2a', 'Chilly Reception');
  await page.locator('.ps-execute-btn').click();

  const history = page.locator('.ps-panel', { hasText: 'Variation moves' });
  for (const [side, chip] of [['P1', 'p1a'], ['P2', 'p2a']] as const) {
    const slot = dockChip(page, chip);
    await expect(slot).toHaveAttribute('data-forced', 'true', { timeout: 120_000 });
    // The engine's replacement stands on the chip, marked, and Execute appears for it.
    await expect(slot).toHaveAttribute('data-origin', 'engine', { timeout: 240_000 });
    await expect(slot).toContainText('→');
    const execute = page.locator('.ps-execute-btn');
    await expect(execute).toBeEnabled();
    await execute.click();
    await expect(history).toContainText(`forced replacement (${side})`, { timeout: 60_000 });
  }
  await expect(page.locator('.ps-force-switch-note')).toHaveCount(0, { timeout: 30_000 });
});
