import { test, expect, type Locator, type Page } from '@playwright/test';
import { dockChip, dockReplays, dockTray, installReplayEmbedCache, routeOfflineFixtures } from './helpers';
import {
  Clicks, DOUBLES_SLOTS, TASK_VIEWPORT, expectChipsShowLoggedTurn, expectDockLayout, expectEverySlotActed, expectExecutedLoggedTurn,
  lightEngine, loadDockReplay, loggedTurn, openVariationHistory, variationPanel,
} from './dock-helpers';

// A side takes Mega Evolution once, so only a turn before the logged one has it left to click.
// The bench is read where both sides fielded four: a short side lists its fielded bodies plus a guessed world.
const SV_VGC = 'gen9vgc2026regi-2573391549';
const CHAMPIONS = 'gen9championsvgc2026regma-2625939941';
const CHAMPIONS_PINNED = 'gen9championsvgc2026regma-2623421463';
const replayOf = (id: string) => dockReplays.find(replay => replay.id === id)!;

test.beforeAll(installReplayEmbedCache);
test.use({ viewport: TASK_VIEWPORT });

test.beforeEach(async ({ page }) => {
  await lightEngine(page);
  await routeOfflineFixtures(page);
  await page.goto('/');
});

const execute = (page: Page) => page.locator('.ps-execute-btn');
const benchNames = (tray: Locator) => tray.locator('.ps-switchbtn .ps-switchbtn-name').allInnerTexts();
const hasBody = (names: string[], body: string) => names.some(name => name.includes(body));

test.describe('Scarlet/Violet VGC, turn 3', () => {
  test.beforeEach(async ({ page }) => {
    await loadDockReplay(page, SV_VGC, 3);
    await expectDockLayout(page);
  });

  test('task 4, Tera: 3 clicks (chip, "Tera (type)", Execute); the bench lists the four brought bodies only', async ({ page }) => {
    test.setTimeout(180_000);
    const clicks = new Clicks();
    await clicks.click(dockChip(page, 'p1a'));
    const tray = dockTray(page);
    const bench = await benchNames(tray);
    expect(bench, 'bench of P1A').toHaveLength(2);
    expect(hasBody(bench, 'Miraidon') && hasBody(bench, 'Landorus')).toBe(true);
    expect(hasBody(bench, 'Urshifu') || hasBody(bench, 'Calyrex')).toBe(false);
    await expectDockLayout(page);
    const tera = tray.getByRole('button', { name: /^Tera \(/ });
    await clicks.click(tera);
    await expect(tera).toHaveAttribute('aria-pressed', 'true');
    await expect(dockChip(page, 'p1a')).toContainText('· Tera');
    await expectDockLayout(page);
    await clicks.click(execute(page));
    expect(clicks.count).toBe(3);
    await expect(variationPanel(page)).toContainText('Turn 3', { timeout: 90_000 });
    await openVariationHistory(page);
    await expect(variationPanel(page).getByText(/\(Tera\)/).first()).toBeVisible();
    await expect(variationPanel(page)).toContainText(/Bleakwind Storm[^|]*\(Tera\)/);
  });

  test('criterion 5, Execute without a change plays the logged turn with its Tera: 1 click', async ({ page }) => {
    test.setTimeout(240_000);
    const replay = replayOf(SV_VGC);
    const actions = loggedTurn(replay, 3);
    expectEverySlotActed(actions, DOUBLES_SLOTS, `${SV_VGC} turn 3`);
    expect(actions.filter(action => action.tera).map(action => action.slot)).toEqual(['p2a']);
    await expectChipsShowLoggedTurn(page, actions);
    const clicks = new Clicks();
    await clicks.click(execute(page));
    expect(clicks.count).toBe(1);
    await expectExecutedLoggedTurn(page, replay, 3, actions);
  });
});

test.describe('Champions VGC', () => {
  test('Mega Evolve: 3 clicks (chip, "Mega Evolve", Execute); no Tera toggle; the bench lists the brought bodies only', async ({ page }) => {
    test.setTimeout(180_000);
    await loadDockReplay(page, CHAMPIONS_PINNED, 1);
    await expectDockLayout(page);
    const clicks = new Clicks();
    await clicks.click(dockChip(page, 'p2a'));
    const tray = dockTray(page);
    const bench = await benchNames(tray);
    expect(bench, 'bench of P2A').toHaveLength(2);
    expect(hasBody(bench, 'Pelipper') && hasBody(bench, 'Basculegion')).toBe(true);
    expect(hasBody(bench, 'Sneasler') || hasBody(bench, 'Sinistcha')).toBe(false);
    await expect(tray.getByRole('button', { name: /^Tera/ })).toHaveCount(0);
    await expectDockLayout(page);
    const mega = tray.getByRole('button', { name: 'Mega Evolve' });
    await clicks.click(mega);
    await expect(mega).toHaveAttribute('aria-pressed', 'true');
    await expect(dockChip(page, 'p2a')).toContainText('· Mega');
    await expectDockLayout(page);
    await clicks.click(execute(page));
    expect(clicks.count).toBe(3);
    await expect(variationPanel(page)).toContainText('Turn 1', { timeout: 90_000 });
    await expect(variationPanel(page)).toContainText(/Protect[^|]*\(Mega\)/);
  });

  test('criterion 5, turn 2: Execute without a change plays the logged turn with its two Mega Evolutions: 1 click', async ({ page }) => {
    test.setTimeout(240_000);
    const replay = replayOf(CHAMPIONS);
    await loadDockReplay(page, CHAMPIONS, 2);
    const actions = loggedTurn(replay, 2);
    expectEverySlotActed(actions, DOUBLES_SLOTS, `${CHAMPIONS} turn 2`);
    expect(actions.filter(action => action.mega).map(action => action.slot).sort()).toEqual(['p1b', 'p2a']);
    await expectChipsShowLoggedTurn(page, actions);
    await expectDockLayout(page);
    const clicks = new Clicks();
    await clicks.click(execute(page));
    expect(clicks.count).toBe(1);
    await expectExecutedLoggedTurn(page, replay, 2, actions);
  });
});
