import { test, expect, type Page } from '@playwright/test';
import { dockChip, dockReplays, dockTray, fixtureReplay, installReplayEmbedCache, routeOfflineFixtures, waitForExactPickers } from './helpers';
import {
  Clicks, DOUBLES_SLOTS, TASK_VIEWPORT, branchFrameEntries, expectChipsShowLoggedTurn, expectDockLayout, expectEverySlotActed,
  expectExecutedLoggedTurn, lightEngine, loadDockReplay, loggedTurn, variationPanel,
} from './dock-helpers';

/**
 * Round 84 (turn dock), step A6c: the tasks of the spec's success criteria 1 to 5 at 1366 x 768 with no variation standing, each
 * held to its click count (loading the fixture and waiting for the exact pickers do not count; Done is never needed, Execute
 * closes the tray). Doubles OU runs on turn 5 of `gen9doublesou-2693620934`, where all four active slots acted (plan C2): Zapdos
 * Knock Off and Dragonite Rock Slide on one side, Farigiraf Trick Room and Glimmora Sludge Bomb on the other. The Tera and Mega
 * tasks are in `turn-dock-vgc.spec.ts`, counted on their own.
 */
const DOUBLES = 'gen9doublesou-2693620934';
const TURN = 5;
const doublesReplay = dockReplays.find(replay => replay.id === DOUBLES)!;

test.beforeAll(installReplayEmbedCache);
test.use({ viewport: TASK_VIEWPORT });

test.beforeEach(async ({ page }) => {
  await lightEngine(page);
  await routeOfflineFixtures(page);
  await page.goto('/');
});

const execute = (page: Page) => page.locator('.ps-execute-btn');

test.describe('Doubles OU, turn 5, no variation standing', () => {
  test.beforeEach(async ({ page }) => {
    await loadDockReplay(page, DOUBLES, TURN);
    await expectDockLayout(page);
  });

  test('task 1, a move instead of the played one: 3 clicks (chip, tile, Execute)', async ({ page }) => {
    test.setTimeout(180_000);
    const clicks = new Clicks();
    await clicks.click(dockChip(page, 'p1a'));
    const other = dockTray(page).locator('.ps-movebtn:enabled', { hasNotText: 'Knock Off' }).first();
    const name = ((await other.locator('.ps-movebtn-name').first().textContent()) ?? '').trim();
    expect(name).not.toBe('');
    await clicks.click(other);
    await expect(dockChip(page, 'p1a')).toContainText(name);
    await expect(dockChip(page, 'p1a')).not.toHaveAttribute('data-origin', 'played');
    await expectDockLayout(page);
    await clicks.click(execute(page));
    expect(clicks.count).toBe(3);
    await expect(variationPanel(page)).toContainText(`Turn ${TURN}`, { timeout: 90_000 });
    await expect(variationPanel(page)).toContainText(name);
    await expect(variationPanel(page)).not.toContainText('Knock Off');
    await expect(variationPanel(page)).toContainText('Rock Slide');
  });

  test('task 2, a forced flinch: 4 clicks (chip, "Dice · What if", Flinch in the target\'s column, Execute)', async ({ page }) => {
    test.setTimeout(180_000);
    const clicks = new Clicks();
    await clicks.click(dockChip(page, 'p1b'));
    const tray = dockTray(page);
    await expectDockLayout(page);
    await clicks.click(tray.getByRole('button', { name: /Dice · What if/ }));
    // Farigiraf (P2A) moves after Dragonite's Rock Slide, so its column is the one that matters.
    const flinch = tray.getByRole('group', { name: /^Flinch against P2A/ }).getByRole('button', { name: 'Flinch', exact: true });
    await expect(flinch).toBeVisible({ timeout: 30_000 });
    await clicks.click(flinch);
    await expect(flinch).toHaveAttribute('aria-pressed', 'true');
    await expect(dockChip(page, 'p1b')).toContainText('· dice');
    await expectDockLayout(page);
    await clicks.click(execute(page));
    expect(clicks.count).toBe(4);
    await expect(variationPanel(page)).toContainText(`Turn ${TURN}`, { timeout: 90_000 });
    await expect(page.getByRole('group', { name: 'Forced dice' })).toContainText(/Rock Slide.*Flinch/);
    const entries = await branchFrameEntries(page);
    await expect.poll(async () => (await entries()).some(entry => entry.startsWith('Forced: Rock Slide flinch')), { timeout: 60_000 }).toBe(true);
  });

  test('task 3, a switch: 3 clicks (chip, bench tile, Execute)', async ({ page }) => {
    test.setTimeout(180_000);
    const clicks = new Clicks();
    await clicks.click(dockChip(page, 'p1a'));
    await clicks.click(dockTray(page).locator('.ps-switchbtn:enabled').first());
    const pick = ((await dockChip(page, 'p1a').locator('.ps-dock-pick').innerText()) ?? '').trim();
    expect(pick).toMatch(/^→ \S/);
    await expectDockLayout(page);
    await clicks.click(execute(page));
    expect(clicks.count).toBe(3);
    await expect(variationPanel(page)).toContainText(`Turn ${TURN}`, { timeout: 90_000 });
    await expect(variationPanel(page)).toContainText(pick);
  });

  test('task 5, a What-if move: 6 clicks (chip, "Dice · What if", the field, the option, "Load move", Execute); the plan predicted 8', async ({ page }) => {
    // The plan counted a second chip click and the loaded tile. The rebuild that "Load move" starts seeds the loaded move as the
    // slot's pending choice (useAppController), so the chip names it at once and Execute follows. The other slots start empty at
    // that fresh tip, the engine fills them, and the pressed Execute waits for the fill.
    test.setTimeout(300_000);
    const clicks = new Clicks();
    await clicks.click(dockChip(page, 'p1b'));
    const tray = dockTray(page);
    await clicks.click(tray.getByRole('button', { name: /Dice · What if/ }));
    const field = tray.getByLabel('Hypothetical move for P1B');
    await expect(field).toBeVisible({ timeout: 30_000 });
    await clicks.click(field);
    await field.fill('Extreme S');
    await clicks.click(tray.getByRole('option', { name: 'Extreme Speed' }));
    await expect(field).toHaveValue('Extreme Speed');
    await clicks.click(tray.locator('button', { hasText: 'Load move' }));
    await expect(dockChip(page, 'p1b')).toContainText('Extreme Speed', { timeout: 30_000 });
    await expect(dockTray(page)).toHaveCount(0);
    await expectDockLayout(page);
    await clicks.click(execute(page));
    expect(clicks.count).toBe(6);
    await expect(variationPanel(page)).toContainText(`Turn ${TURN}`, { timeout: 240_000 });
    await expect(variationPanel(page)).toContainText('Extreme Speed');
  });

  test('criterion 5, Execute without a change plays the logged turn: 1 click, the row and the frame name the logged moves and targets', async ({ page }) => {
    test.setTimeout(240_000);
    const actions = loggedTurn(doublesReplay, TURN);
    expectEverySlotActed(actions, DOUBLES_SLOTS, `${DOUBLES} turn ${TURN}`);
    await expectChipsShowLoggedTurn(page, actions);
    await expectDockLayout(page);
    const clicks = new Clicks();
    await clicks.click(execute(page));
    expect(clicks.count).toBe(1);
    await expectExecutedLoggedTurn(page, doublesReplay, TURN, actions);
  });
});

test.describe('singles, turn 1, no variation standing', () => {
  test.beforeEach(async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    await waitForExactPickers(page);
    await expect(dockChip(page, 'p1a')).toBeVisible({ timeout: 30_000 });
    await expectDockLayout(page);
  });

  test('task 6, a singles move: 3 clicks (chip, tile, Execute)', async ({ page }) => {
    test.setTimeout(180_000);
    const clicks = new Clicks();
    await clicks.click(dockChip(page, 'p1a'));
    const other = dockTray(page).locator('.ps-movebtn:enabled', { hasNotText: 'Earthquake' }).first();
    const name = ((await other.locator('.ps-movebtn-name').first().textContent()) ?? '').trim();
    expect(name).not.toBe('');
    await clicks.click(other);
    await expect(dockChip(page, 'p1a')).toContainText(name);
    await expectDockLayout(page);
    await clicks.click(execute(page));
    expect(clicks.count).toBe(3);
    await expect(variationPanel(page)).toContainText('Turn 1', { timeout: 90_000 });
    await expect(variationPanel(page)).toContainText(name);
    await expect(variationPanel(page)).not.toContainText('Earthquake');
  });

  test('criterion 5, singles: Execute without a change plays the logged turn (1 click)', async ({ page }) => {
    test.setTimeout(180_000);
    const actions = loggedTurn(fixtureReplay, 1);
    expectEverySlotActed(actions, ['p1a', 'p2a'], 'the singles fixture turn 1');
    await expectChipsShowLoggedTurn(page, actions);
    const clicks = new Clicks();
    await clicks.click(execute(page));
    expect(clicks.count).toBe(1);
    await expectExecutedLoggedTurn(page, fixtureReplay, 1, actions);
  });
});
