import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { emptySmogon, routeSmogon } from './smogon-routes';
import { dockChip, fixturePath, installReplayEmbedCache, openTray, pickMove, routeOfflineFixtures, waitForExactPickers } from './helpers';
import { lightEngine, loadDockReplay, variationPanel } from './dock-helpers';

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

/**
 * Round 84 (A7c, ruling 16a; A7d: a scene the sim fixes): doubles, both slots of P1 forced. The hand-written replay
 * `gen9doubles-forced-test` gives Pikachu and Eevee a Memento each, and Memento faints its user when it hits (accuracy 100, no
 * damage roll decides it), so the executed turn 1 leaves P1A and P1B to replace from a bench of four (Raichu, Jolteon, Vaporeon,
 * Flareon) and P2 untouched. The engine fills both. A bench click in P1A while P1B holds only the engine's pick records the choice and
 * sends nothing; Execute stays and sends the turn with the user's pick in P1A and the engine's in P1B. (The A7c case took turn 6 of a
 * corpus game whose two faints depend on the damage rolls; the sim never asked for both replacements there.)
 */
const BENCH = ['Raichu', 'Jolteon', 'Vaporeon', 'Flareon'];

test('two forced slots of one side: a bench click records the choice while the other holds only the engine pick', async ({ page }) => {
  test.setTimeout(420_000);
  await lightEngine(page);
  await routeOfflineFixtures(page);
  await page.goto('/');
  await loadDockReplay(page, 'gen9doubles-forced-test', 1);
  // The first move of every other slot (Vine Whip, Ember) and Memento in both P1 slots; nobody protects.
  await pickMove(page, 'p1a', 'Memento');
  await pickMove(page, 'p1b', 'Memento');
  await pickMove(page, 'p2a');
  await pickMove(page, 'p2b');
  const execute = page.locator('.ps-execute-btn');
  await expect(execute).toBeEnabled();
  await execute.click();

  const [p1a, p1b] = [dockChip(page, 'p1a'), dockChip(page, 'p1b')];
  for (const chip of [p1a, p1b]) {
    await expect(chip).toHaveAttribute('data-forced', 'true', { timeout: 120_000 });
    await expect(chip).toHaveAttribute('data-origin', 'engine', { timeout: 240_000 });
  }
  await expect(dockChip(page, 'p2a')).not.toHaveAttribute('data-forced', 'true');
  await expect(dockChip(page, 'p2b')).not.toHaveAttribute('data-forced', 'true');
  const taken = `${await p1a.textContent()} ${await p1b.textContent()}`;
  const body = BENCH.find(name => !taken.includes(name))!;
  expect(body, 'a bench body the engine did not pick').toBeTruthy();

  const tray = await openTray(page, 'p1a');
  await tray.locator('.ps-switchbtn:enabled', { hasText: body }).click();
  await expect(p1a).toContainText(body);
  // Nothing went out: the old behaviour sent the turn at once and the position moved on within a worker round trip.
  await page.waitForTimeout(2_000);
  await expect(p1a).toHaveAttribute('data-forced', 'true');
  await expect(p1a).not.toHaveAttribute('data-origin', 'engine');
  await expect(p1b).toHaveAttribute('data-origin', 'engine');
  await expect(variationPanel(page)).not.toContainText('forced replacement');
  await expect(execute).toBeEnabled();

  await execute.click();
  await expect(page.locator('.ps-dock-chip[data-forced="true"]')).toHaveCount(0, { timeout: 120_000 });
  await expect(page.locator('.ps-force-switch-note')).toHaveCount(0, { timeout: 30_000 });
  await expect(variationPanel(page)).toContainText('forced replacement (P1)');
});
