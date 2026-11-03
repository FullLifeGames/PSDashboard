import { test, expect } from '@playwright/test';
import { routeSmogon, emptySmogon } from './smogon-routes';
import { expectReplaySettled, fixturePath, installReplayEmbedCache, openTrayMore, pickMove, routeOfflineFixtures, waitForExactPickers } from './helpers';
import { openVariationHistory } from './dock-helpers';

/**
 * Round 82 (forced dice), criterion 5: the draft league replay DzBQ5azlO5l, turn 13. Noivern's Air Slash left Cobalion's flinch
 * undrawn in the game (Cobalion answered with Heavy Slam). The user picks the chip "Flinch" and executes: the
 * branch frame shows Cobalion flinching, and the display line of the forced die stands before it ("Forced: Air Slash flinch,
 * 30 %"). The nickname of Cobalion in this game is "King Bradley", which the frame prints.
 */
test.beforeAll(installReplayEmbedCache);

test('Air Slash with the chip "Flinch": the branch frame shows Cobalion flinching, with the mark', async ({ page }) => {
  test.setTimeout(240_000);
  await routeOfflineFixtures(page);
  await page.goto('/');
  await routeSmogon(page, emptySmogon);
  await page.locator('input[aria-label="Load exported replay file"]').setInputFiles(fixturePath('gpl-replay-DzBQ5azlO5l.html'));
  await expect(page.locator('.ps-branch-bar input[type="range"]')).toBeVisible({ timeout: 30_000 });

  await waitForExactPickers(page, 13);

  // Round 84 (turn dock): the move through the tray, the dice behind "Dice · What if" (the tray of the slot that moved).
  await pickMove(page, 'p1a', 'Air Slash');
  const tray = await openTrayMore(page, 'p1a');
  const flinch = tray.getByRole('group', { name: 'Flinch', exact: true }).getByRole('button', { name: 'Flinch', exact: true });
  await expect(flinch).toBeVisible({ timeout: 30_000 });
  await flinch.click();
  await expect(flinch).toHaveAttribute('aria-pressed', 'true');
  await pickMove(page, 'p2a', 'Heavy Slam');
  await page.locator('.ps-execute-btn').click();
  await expect(page.locator('.ps-panel', { hasText: 'Variation moves' })).toContainText('Turn 13', { timeout: 90_000 });

  const frame = await (await page.locator('iframe[title="Branch Simulation"]').elementHandle({ timeout: 30_000 }))?.contentFrame();
  expect(frame).toBeTruthy();
  await expectReplaySettled(frame!);
  const entries = () => frame!.evaluate(() => [...document.querySelectorAll('.battle-log .battle-history')].map(entry => entry.textContent ?? ''));
  await expect.poll(async () => (await entries()).some(entry => /flinched/.test(entry)), { timeout: 60_000 }).toBe(true);
  const shown = await entries();
  const mark = shown.findIndex(entry => entry === 'Forced: Air Slash flinch, 30 %');
  const flinched = shown.findIndex(entry => /King Bradley flinched/.test(entry));
  expect(mark).toBeGreaterThanOrEqual(0);
  expect(flinched).toBeGreaterThan(mark);
  expect(shown.filter(entry => entry.startsWith('Forced: Air Slash flinch'))).toHaveLength(1);
  // the history row lists the die as well (round 84, ruling 18a: the closed history opens first, a role query skips hidden rows)
  await openVariationHistory(page);
  await expect(page.getByRole('group', { name: 'Forced dice' })).toContainText('P1 Air Slash: Flinch');
});
