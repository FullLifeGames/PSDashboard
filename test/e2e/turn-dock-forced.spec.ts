import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { emptySmogon, routeSmogon } from './smogon-routes';
import { dockChip, fixturePath, installReplayEmbedCache, openTray, pickForcedReplacement, pickMove, routeOfflineFixtures, waitForExactPickers } from './helpers';
import { DOUBLES_SLOTS, lightEngine, loadDockReplay, variationPanel } from './dock-helpers';

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

/**
 * Round 84 (A7f): the partner of a forced replacement takes no input. Same hand-written replay, but only Pikachu uses Memento, so
 * P1A alone must be replaced and Eevee (P1B) keeps its place: the position asks nothing of it, so its chip stands inert like the
 * chips of the waiting side (P2A, P2B), while P1A's chip stays live and the engine fills it.
 */
test('one forced slot in doubles: its partner stands inert like the waiting side, the forced slot stays live', async ({ page }) => {
  test.setTimeout(420_000);
  await lightEngine(page);
  await routeOfflineFixtures(page);
  await page.goto('/');
  await loadDockReplay(page, 'gen9doubles-forced-test', 1);
  await pickMove(page, 'p1a', 'Memento');
  // Eevee's first tile is its own Memento; Protect keeps it on the field.
  await pickMove(page, 'p1b', 'Protect');
  await pickMove(page, 'p2a');
  await pickMove(page, 'p2b');
  const execute = page.locator('.ps-execute-btn');
  await expect(execute).toBeEnabled();
  await execute.click();

  const [p1a, p1b] = [dockChip(page, 'p1a'), dockChip(page, 'p1b')];
  await expect(p1a).toHaveAttribute('data-forced', 'true', { timeout: 120_000 });
  await expect(p1a).toHaveAttribute('data-origin', 'engine', { timeout: 240_000 });
  await expect(p1b).not.toHaveAttribute('data-forced', 'true');
  await expect(p1a).not.toHaveAttribute('inert');
  await expect(p1b).toHaveAttribute('inert', '');
  await expect(dockChip(page, 'p2a')).toHaveAttribute('inert', '');
  await expect(dockChip(page, 'p2b')).toHaveAttribute('inert', '');
  // The inert chip opens no tray; the forced slot's chip does.
  await p1b.click({ force: true });
  await expect(page.locator('.ps-tray')).toHaveCount(0);
  await openTray(page, 'p1a');
  await expect(page.locator('.ps-tray')).toHaveCount(1);
});

/**
 * Round 84 (A7h): the bench click that comes while the engine's run for the replacement is still under way. Champions VGC
 * 2625939941, turn 1 with the logged picks: Flip Turn asks P1B for a replacement and the fill starts its run for that request. The
 * user sends a body at once (ruling 2a), so the next request, the moves of turn 2, begins with that run still going. It carries
 * the same evalViewKey (`variation:2`), and its result is the replacement's analysis: the fill must not settle on it. It starts its
 * own run, and all four chips of turn 2 take the engine's pick with Execute ready.
 */
test('a bench click while the run for the replacement is under way: the next request is filled by its own run', async ({ page }) => {
  test.setTimeout(420_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await lightEngine(page);
  await routeOfflineFixtures(page);
  await page.goto('/');
  await loadDockReplay(page, 'gen9championsvgc2026regma-2625939941', 1);
  await page.locator('.ps-execute-btn').click();
  await expect(page.locator('.ps-dock-chip[data-forced="true"]:not([inert])').first()).toBeVisible({ timeout: 120_000 });
  await pickForcedReplacement(page);
  await expect(page.locator('.ps-dock-chip[data-forced="true"]')).toHaveCount(0, { timeout: 60_000 });
  await expect(variationPanel(page)).toContainText('forced replacement', { timeout: 30_000 });
  for (const slot of DOUBLES_SLOTS) {
    await expect(dockChip(page, slot)).toHaveAttribute('data-origin', 'engine', { timeout: 240_000 });
  }
  await expect(page.locator('.ps-execute-btn')).toHaveText('Execute Turn');
  await expect(page.locator('.ps-execute-btn')).toBeEnabled();
});
