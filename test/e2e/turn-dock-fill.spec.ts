import { test, expect, type Page } from '@playwright/test';
import { dockChip, dockTray, installReplayEmbedCache, openTray, pickForcedReplacement, routeOfflineFixtures, type DockSlotKey } from './helpers';
import {
  DOUBLES_SLOTS, TASK_VIEWPORT, chipBoxes, expectDockLayout, expectSameBoxes, heldEvalMessages, holdEval, installEvalGate, lightEngine,
  loadDockReplay, releaseEval, variationPanel,
} from './dock-helpers';

/**
 * Round 84 (turn dock), step A6c: the engine's fill with a delayed engine. `installEvalGate` holds the evaluation pool's messages
 * (no production code: an init script wraps the workers), so the spec decides when the engine answers. The scenes:
 *  - the tip of a variation: the untouched chips hold a placeholder, then fill, and no chip changes its box; a touched slot keeps
 *    the user's pick;
 *  - Execute pressed before the fill reads "Waits for engine…" and runs after it;
 *  - "Analyze game" running: no fill starts;
 *  - a replay turn (Q19 b): the first click on a chip starts the run, the slot whose tray is open stays empty, the other empty
 *    slot fills.
 */
const TIP_GAME = 'gen9doublesou-2693620934';
const FLINCH_GAME = 'gen9doublesou-2662153814';

test.beforeAll(installReplayEmbedCache);
test.use({ viewport: TASK_VIEWPORT });

test.beforeEach(async ({ page }) => {
  await installEvalGate(page);
  await lightEngine(page);
  await routeOfflineFixtures(page);
  await page.goto('/');
});

const pickLine = (page: Page, slot: DockSlotKey) => dockChip(page, slot).locator('.ps-dock-pick');

/** Executes the seeded turn at the replay turn and settles the forced replacements that follow, so the tip stands with empty chips. */
async function executeSeededTurn(page: Page, turn: number): Promise<void> {
  await page.locator('.ps-execute-btn').click();
  await expect(variationPanel(page)).toContainText(`Turn ${turn}`, { timeout: 90_000 });
  for (let round = 0; round < 3; round++) {
    const note = page.locator('.ps-force-switch-note').first();
    await note.waitFor({ state: 'visible', timeout: 4000 }).catch(() => {});
    if (!await note.isVisible().catch(() => false)) break;
    await pickForcedReplacement(page);
    await expect(note).toBeHidden({ timeout: 30_000 });
  }
}

/** The tip of a variation with the engine held: every chip is empty and waits for the engine. */
async function reachHeldTip(page: Page): Promise<void> {
  await loadDockReplay(page, TIP_GAME, 1);
  await holdEval(page);
  await executeSeededTurn(page, 1);
  for (const slot of DOUBLES_SLOTS) {
    await expect(dockChip(page, slot)).toHaveAttribute('data-empty', 'true', { timeout: 30_000 });
    await expect(pickLine(page, slot)).toHaveAttribute('data-wait', 'pending', { timeout: 30_000 });
    await expect(dockChip(page, slot)).toContainText('engine choosing…');
  }
}

test('at the tip of a variation the untouched chips fill, a touched slot keeps the pick, and no chip changes its box', async ({ page }) => {
  test.setTimeout(300_000);
  await reachHeldTip(page);
  await expectDockLayout(page);
  const before = await chipBoxes(page, DOUBLES_SLOTS);

  // The user touches P1A while the engine is still out: the tray opens, a tile is picked.
  const tray = await openTray(page, 'p1a');
  const tile = tray.locator('.ps-movebtn:enabled').first();
  const picked = ((await tile.locator('.ps-movebtn-name').first().textContent()) ?? '').trim();
  await tile.click();
  await expect(dockChip(page, 'p1a')).toContainText(picked);
  expectSameBoxes(await chipBoxes(page, DOUBLES_SLOTS), before, 'during, tray open');
  await dockTray(page).getByRole('button', { name: 'Done', exact: true }).click();
  expectSameBoxes(await chipBoxes(page, DOUBLES_SLOTS), before, 'during, tray closed');
  for (const slot of ['p1b', 'p2a', 'p2b'] as const) await expect(dockChip(page, slot)).toHaveAttribute('data-empty', 'true');

  await releaseEval(page);
  for (const slot of ['p2a', 'p2b'] as const) {
    await expect(dockChip(page, slot)).toHaveAttribute('data-origin', 'engine', { timeout: 180_000 });
    await expect(dockChip(page, slot)).not.toHaveAttribute('data-empty', 'true');
  }
  // P1B has to agree with the touched P1A: the engine's choice fills it, or no ranked choice agrees and it reads "choose"; it no longer waits.
  await expect(pickLine(page, 'p1b')).not.toHaveAttribute('data-wait', 'pending', { timeout: 30_000 });
  await expect(dockChip(page, 'p1a')).toContainText(picked);
  await expect(dockChip(page, 'p1a')).not.toHaveAttribute('data-origin', 'engine');
  expectSameBoxes(await chipBoxes(page, DOUBLES_SLOTS), before, 'after the fill');
  await expectDockLayout(page);
});

test('Execute pressed before the fill reads "Waits for engine…" and runs the turn after the fill', async ({ page }) => {
  test.setTimeout(300_000);
  await reachHeldTip(page);
  const execute = page.locator('.ps-execute-btn');
  await expect(execute).toBeEnabled();
  await execute.click();
  await expect(execute).toHaveText('Waits for engine…');
  await expect(execute).toBeDisabled();
  // The engine has not answered: no second turn row, and the chips still wait.
  await expect(variationPanel(page)).not.toContainText('Turn 2');
  await expect(pickLine(page, 'p2a')).toHaveAttribute('data-wait', 'pending');

  await releaseEval(page);
  await expect(variationPanel(page)).toContainText('Turn 2', { timeout: 240_000 });
  // The turn ran and the queue is gone. The button itself may be hidden: the next position can ask for a forced replacement, and
  // Execute does not show there.
  await expect(page.getByText('Waits for engine…')).toHaveCount(0);
});

/** The game analysis (with the engine held, so it keeps running) started from the eval panel; resolves once the sweep runs. */
async function startAnalysis(page: Page): Promise<() => Promise<boolean>> {
  type DebugWindow = Window & { __psDebug?: { graph: { running: boolean } } };
  const analysisRuns = () => page.evaluate(() => (window as DebugWindow).__psDebug?.graph.running ?? false);
  await page.locator('.ps-main-right .ps-eval-panel').locator('button', { hasText: 'Analyze game' }).click();
  await expect.poll(analysisRuns, { timeout: 30_000 }).toBe(true);
  return analysisRuns;
}

test('opening a variation ends the analysis that runs at the replay turn, and the fill starts at once', async ({ page }) => {
  test.setTimeout(240_000);
  // Entering branch mode resets the evaluation (useEvalView, useDockFill.sweep.spec): nothing is left for the fill to stop.
  await loadDockReplay(page, TIP_GAME, 1);
  await holdEval(page);
  const analysisRuns = await startAnalysis(page);
  await executeSeededTurn(page, 1);
  await expect.poll(analysisRuns, { timeout: 30_000 }).toBe(false);
  for (const slot of DOUBLES_SLOTS) await expect(pickLine(page, slot)).toHaveAttribute('data-wait', 'pending', { timeout: 30_000 });
});

test('while "Analyze game" runs no fill starts: the chips say the engine is busy and the analysis keeps running', async ({ page }) => {
  test.setTimeout(300_000);
  // The analysis can only start at a tip once no single evaluation runs there, so the first tip fills with the engine free. The
  // analysis then starts (the engine held keeps it running) and the next turn is executed from the filled chips: branch mode
  // stays, so the sweep keeps running and the new tip must not fill.
  await loadDockReplay(page, TIP_GAME, 1);
  await executeSeededTurn(page, 1);
  for (const slot of DOUBLES_SLOTS) {
    await expect(dockChip(page, slot)).toHaveAttribute('data-origin', 'engine', { timeout: 180_000 });
  }
  await holdEval(page);
  const analysisRuns = await startAnalysis(page);
  await executeSeededTurn(page, 2);
  for (const slot of DOUBLES_SLOTS) {
    await expect(pickLine(page, slot)).toHaveAttribute('data-wait', 'busy', { timeout: 30_000 });
    await expect(dockChip(page, slot)).toContainText('engine busy with the game analysis');
  }
  // A fill would have started a single evaluation, which stops the sweep. Give it time to show.
  await page.waitForTimeout(2000);
  expect(await analysisRuns()).toBe(true);
  await expect(page.getByText(/Analysis stopped at turn/)).toHaveCount(0);
  for (const slot of DOUBLES_SLOTS) {
    await expect(dockChip(page, slot)).toHaveAttribute('data-empty', 'true');
    await expect(dockChip(page, slot)).not.toHaveAttribute('data-origin', 'engine');
  }
  // Cancelling the analysis frees the engine: the fill starts for the position.
  await page.locator('.ps-main-right .ps-eval-panel').locator('button', { hasText: /^Cancel$/ }).first().click();
  for (const slot of DOUBLES_SLOTS) await expect(pickLine(page, slot)).toHaveAttribute('data-wait', 'pending', { timeout: 30_000 });
});

test('Q19 b, at a replay turn: the first click on the flinched slot\'s chip starts the run, that slot stays empty while its tray is open, the other empty slot fills, no chip changes its box', async ({ page }) => {
  test.setTimeout(300_000);
  // Turn 2 of the flinch game: Byeked (P2A) flinches and Coming4UrMum (P2B) faints before it moves, so both P2 slots start empty.
  await loadDockReplay(page, FLINCH_GAME, 2);
  await holdEval(page);
  for (const slot of ['p2a', 'p2b'] as const) {
    await expect(dockChip(page, slot)).toHaveAttribute('data-empty', 'true');
    await expect(dockChip(page, slot)).toContainText('no logged move · choose');
  }
  for (const slot of ['p1a', 'p1b'] as const) await expect(dockChip(page, slot)).toHaveAttribute('data-origin', 'played');
  const before = await chipBoxes(page, DOUBLES_SLOTS);
  expect(await heldEvalMessages(page), 'no engine request before the first click').toBe(0);

  // The first click: it opens the flinched slot's tray and starts the run.
  await dockChip(page, 'p2a').click();
  await expect(dockChip(page, 'p2a')).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(() => heldEvalMessages(page), { timeout: 60_000, message: 'the first click starts the run' }).toBeGreaterThan(0);
  await expect(pickLine(page, 'p2b')).toHaveAttribute('data-wait', 'pending');
  expectSameBoxes(await chipBoxes(page, DOUBLES_SLOTS), before, 'during the run');

  await releaseEval(page);
  await expect(dockChip(page, 'p2b')).toHaveAttribute('data-origin', 'engine', { timeout: 180_000 });
  // The slot whose tray is open stays empty, whenever the result lands.
  await expect(dockChip(page, 'p2a')).toHaveAttribute('aria-expanded', 'true');
  await expect(dockChip(page, 'p2a')).toHaveAttribute('data-empty', 'true');
  await expect(dockChip(page, 'p2a')).toContainText('no logged move · choose');
  for (const slot of ['p1a', 'p1b'] as const) await expect(dockChip(page, slot)).toHaveAttribute('data-origin', 'played');
  expectSameBoxes(await chipBoxes(page, DOUBLES_SLOTS), before, 'after the fill');
});
