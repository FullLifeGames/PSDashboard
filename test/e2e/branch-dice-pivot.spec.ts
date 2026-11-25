import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { emptySmogon, routeSmogon } from './smogon-routes';
import { fixturePath, installReplayEmbedCache, pickForcedReplacement, pickMove, routeOfflineFixtures, waitForExactPickers } from './helpers';

test.beforeAll(installReplayEmbedCache);

test('U-turn against Chilly Reception from the viewed turn 1: both sides send their switch-in', async ({ page }) => {
  test.setTimeout(240_000);
  const draftReplay = readFileSync(fixturePath('draft-replay.json'), 'utf-8');
  await routeOfflineFixtures(page);
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

  const history = page.locator('.ps-panel', { hasText: 'Variation moves' });
  for (const side of ['P1', 'P2']) {
    await pickForcedReplacement(page, { timeout: 60_000 });
    await expect(history).toContainText(`replacement (${side})`, { timeout: 30_000 });
  }
  await expect(page.getByText('You need a switch response')).toHaveCount(0);
});
