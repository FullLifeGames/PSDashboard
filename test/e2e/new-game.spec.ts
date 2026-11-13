import { test, expect, type Page } from '@playwright/test';
import { installReplayEmbedCache, routeOfflineFixtures, pickMove, fixtureReplay, fixturePath, openLoader, moveTimeline, startVariationAt, dockChip, type DockSlotKey } from './helpers';
import { lightEngine } from './dock-helpers';
import { copiedLink, openInFreshContext, timelineState } from './new-game-helpers';

/**
 * Round 89 (lane H, #105), stage H4: the New game dialog in the browser. A draft-league player pastes two Showdown exports on the
 * start page, picks the format, starts, picks leads (four of six in VGC), plays a turn by hand, opens the game
 * again from the start page's saved list, on its tip. Gen 9 OU and Scarlet/Violet VGC; the engine's turns and the grading are the later stages'.
 */
test.beforeAll(installReplayEmbedCache);

test.beforeEach(async ({ page }) => {
  await lightEngine(page);
  await routeOfflineFixtures(page);
});

const SIX = ['Garchomp', 'Gengar', 'Dragonite', 'Tyranitar', 'Snorlax', 'Starmie'];
const team = (species: string[]) => species.map(name => `${name}\nEVs: 4 HP\n- Protect\n- Earthquake\n- Return\n- Substitute`).join('\n\n');

async function startGame(page: Page, format: { search: string; name: string } | null, names: [string, string]): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'New game' }).click();
  const dialog = page.getByRole('dialog', { name: 'New game' });
  await expect(dialog).toBeVisible();
  if (format) {
    await dialog.getByRole('button', { name: /^Format / }).click();
    await dialog.getByRole('combobox', { name: 'Search formats' }).fill(format.search);
    await dialog.getByRole('option').filter({ has: page.locator('span:first-child', { hasText: new RegExp(`^${format.name.replace(/[[\]()]/g, '\\$&')}$`) }) }).first().click();
  }
  await dialog.getByRole('textbox', { name: 'Player 1 name' }).fill(names[0]);
  await dialog.getByRole('textbox', { name: 'Player 2 name' }).fill(names[1]);
  await dialog.getByRole('textbox', { name: 'Player 1 team' }).fill(team(SIX));
  await dialog.getByRole('textbox', { name: 'Player 2 team' }).fill(team(SIX));
  await expect(dialog.getByText('6 of 6 sets read')).toHaveCount(2);
  await expect(dialog.getByRole('button', { name: 'Start' })).toBeEnabled({ timeout: 60_000 });
  await dialog.getByRole('button', { name: 'Start' }).click();
  await expect(dialog).toBeHidden({ timeout: 60_000 });
}

test('Gen 9 OU: paste, Start at Team Preview, pick leads, play a turn by hand, reload and open the saved game on its tip', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1366, height: 768 });
  await startGame(page, null, ['Tidepool', 'Marrowkid']);
  const bar = page.locator('.ps-topbar');
  await expect(bar.getByText('New game', { exact: true })).toBeVisible();
  await expect(bar.getByText('[Gen 9] OU')).toBeVisible();
  await expect(bar.getByText('Tidepool')).toBeVisible();
  // team preview: the lead picker offers both teams in full
  const lead = page.locator('.ps-lead');
  await expect(lead).toBeVisible({ timeout: 60_000 });
  await expect(lead.locator('.ps-lead-side')).toHaveCount(2);
  await expect(lead.locator('.ps-lead-side').first().locator('.ps-switchbtn')).toHaveCount(6);
  await lead.locator('.ps-lead-side').nth(0).locator('.ps-switchbtn').first().click();
  await lead.locator('.ps-lead-side').nth(1).locator('.ps-switchbtn').first().click();
  await lead.locator('.ps-execute-btn', { hasText: 'Play from turn 0' }).click();
  await expect(page.locator('.ps-dock-chip').first()).toBeVisible({ timeout: 90_000 });
  // turn 1 by hand
  await pickMove(page, 'p1a', 'Earthquake');
  await pickMove(page, 'p2a', 'Protect');
  await page.locator('.ps-dock .ps-execute-btn').click();
  await expect(page.getByText('T2/')).toBeVisible({ timeout: 90_000 });
  // the turn joined the main line: the tip is no variation, so the bar names none and offers no Discard
  await expect(page.getByText(/Branching · Turn/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Discard variation' })).toHaveCount(0);
  await expect(page.getByText('Variation moves')).toHaveCount(0);
  // the game is saved after the finished turn
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('ps-replay-interceptor:games') ?? '[]').length)).toBe(1);

  // the address names the game, so a reload brings it back on its tip (H12a)
  await expect(page).toHaveURL(/[?&]game=newgame-/);
  const gameUrl = page.url();
  await page.reload();
  expect(page.url()).toBe(gameUrl);
  await expect(bar.getByText('New game', { exact: true })).toBeVisible({ timeout: 90_000 });
  await expect(bar.getByText('Tidepool')).toBeVisible();
  await expect(page.getByText('T2/')).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('.ps-dock-chip').first()).toBeVisible({ timeout: 90_000 });

  // the Game menu lists it (third part) and says it is open now; the dialog holds no list
  await page.locator('.ps-loader-toggle').click();
  const menu = page.locator('.ps-loader-panel');
  await expect(menu.getByText('Load replay')).toBeVisible();
  await expect(menu.getByRole('button', { name: 'New game' })).toBeVisible();
  await expect(menu.locator('.ps-newgame-saved-row')).toHaveCount(1);
  await expect(menu.locator('.ps-newgame-saved-row')).toContainText('open now');

  // a fresh visit without a parameter: the start page lists the saved game under the loader, and Open plays it on its tip
  await page.goto('/');
  const landing = page.locator('.ps-entry-landing');
  await expect(landing.getByText('Saved games')).toBeVisible();
  const row = landing.locator('.ps-newgame-saved-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Tidepool');
  await expect(row).toContainText('1 turn played');
  await expect(row).toContainText(/Seed \d+,\d+,\d+,\d+/);
  await row.getByRole('button', { name: 'Open' }).click();
  await expect(page.locator('.ps-topbar').getByText('New game', { exact: true })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText('T2/')).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('.ps-dock-chip').first()).toBeVisible({ timeout: 90_000 });
});

test('Scarlet/Violet VGC: the picker asks for four of six, the first two lead, the bench holds the two brought; a turn by hand joins the main line', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1366, height: 768 });
  await startGame(page, { search: 'vgc 2025', name: '[Gen 9] VGC 2025 Reg I' }, ['Lucario Lab', 'Ferrothorn Fan']);
  const bar = page.locator('.ps-topbar');
  await expect(bar.getByText('[Gen 9] VGC 2025 Reg I')).toBeVisible();
  const lead = page.locator('.ps-lead');
  await expect(lead).toBeVisible({ timeout: 60_000 });
  await expect(lead).toContainText(/pick the 4 each side brings/);
  for (const side of [0, 1]) {
    const tiles = lead.locator('.ps-lead-side').nth(side).locator('.ps-switchbtn');
    await expect(tiles).toHaveCount(6);
    for (let pick = 0; pick < 4; pick += 1) await tiles.nth(pick).click();
  }
  await lead.locator('.ps-execute-btn', { hasText: 'Play from turn 0' }).click();
  await expect(page.locator('.ps-dock-chip').first()).toBeVisible({ timeout: 90_000 });
  for (const slot of ['p1a', 'p1b', 'p2a', 'p2b'] as const) await pickMove(page, slot, 'Protect');
  await page.locator('.ps-dock .ps-execute-btn').click();
  await expect(page.getByText('T2/')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole('button', { name: 'Discard variation' })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('ps-replay-interceptor:games') ?? '[]')[0]?.formatName)).toBe('[Gen 9] VGC 2025 Reg I');
});

/** Picks the leads (and the brought bodies) of a game that asks for them; a format without a team preview starts at turn 1. */
async function playLeads(page: Page, brings: number | null): Promise<void> {
  const lead = page.locator('.ps-lead');
  await expect(lead.or(page.locator('.ps-dock-chip').first()).first()).toBeVisible({ timeout: 90_000 });
  if (await lead.isVisible()) {
    for (const side of [0, 1]) {
      const tiles = lead.locator('.ps-lead-side').nth(side).locator('.ps-switchbtn');
      for (let pick = 0; pick < (brings ?? 1); pick += 1) await tiles.nth(pick).click();
    }
    await lead.locator('.ps-execute-btn', { hasText: 'Play from turn 0' }).click();
  }
  await expect(page.locator('.ps-dock-chip').first()).toBeVisible({ timeout: 90_000 });
}

test('Champions VGC: Start, the leads, a turn by hand joins the main line; the saved row names the format', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1366, height: 768 });
  await startGame(page, { search: 'champions vgc', name: '[Gen 9 Champions] VGC 2026 Reg M-C' }, ['Lucario Lab', 'Ferrothorn Fan']);
  await expect(page.locator('.ps-topbar').getByText('[Gen 9 Champions] VGC 2026 Reg M-C')).toBeVisible();
  await playLeads(page, 4);
  for (const slot of ['p1a', 'p1b', 'p2a', 'p2b'] as const) await pickMove(page, slot, 'Protect');
  await page.locator('.ps-dock .ps-execute-btn').click();
  await expect(page.getByText('T2/')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole('button', { name: 'Discard variation' })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('ps-replay-interceptor:games') ?? '[]')[0]?.formatName)).toBe('[Gen 9 Champions] VGC 2026 Reg M-C');
});

test('a replay loaded by id names itself in the address and a reload opens it again; a file has no address', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Replay URL or ID' }).fill('gen9ou-test-123');
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  await expect(page.locator('.ps-topbar')).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => new URL(page.url()).searchParams.get('replay')).toBe(fixtureReplay.id);
  const replayUrl = page.url();
  await page.reload();
  expect(page.url()).toBe(replayUrl);
  await expect(page.locator('.ps-topbar')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.ps-topbar').getByText(fixtureReplay.players[0], { exact: true })).toBeVisible();
  // a file load leaves no address behind
  const panel = await openLoader(page);
  await panel.locator('input[aria-label="Load exported replay file"]').setInputFiles(fixturePath('gpl-replay.html'));
  await expect.poll(() => new URL(page.url()).searchParams.has('replay')).toBe(false);
  expect(new URL(page.url()).searchParams.has('game')).toBe(false);
});

test('an old ?replay= link still loads, and a ?game= this browser does not hold shows the start page with its notice', async ({ page }) => {
  await page.goto('/?replay=gen9ou-test-123');
  await expect(page.locator('.ps-topbar')).toBeVisible({ timeout: 60_000 });
  await page.goto('/?game=newgame-k3x9q0m2ab');
  await expect(page.getByRole('alert').filter({ hasText: 'newgame-k3x9q0m2ab is not saved in this browser' })).toBeVisible();
  await expect(page.getByText('Load Replay')).toBeVisible();
  await expect(page.locator('.ps-topbar')).toHaveCount(0);
});

test('390 px: the top bar keeps its lines with Game, the menu fits the screen, the start page lists the saved game; Start saved it before any lead was played', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await startGame(page, null, ['Tidepool', 'Marrowkid']);
  // saved at once (D-E1) and named in the address, with no lead played
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('ps-replay-interceptor:games') ?? '[]').length)).toBe(1);
  await expect(page).toHaveURL(/[?&]game=newgame-/);
  await page.reload();
  const bar = page.locator('.ps-topbar');
  await expect(bar.getByText('New game', { exact: true })).toBeVisible({ timeout: 90_000 });
  const toggle = page.locator('.ps-loader-toggle');
  await expect(toggle).toHaveText(/Game/);
  const noSideways = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(await noSideways()).toBe(true);
  await toggle.click();
  const panel = page.locator('.ps-loader-panel');
  await expect(panel.getByRole('button', { name: 'New game' })).toBeVisible();
  const box = await panel.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await expect(panel.locator('.ps-newgame-saved-row')).toContainText('open now');
  await page.keyboard.press('Escape');
  // a fresh visit: the saved game stands on the start page
  await page.goto('/');
  const landing = page.locator('.ps-entry-landing');
  await expect(landing.locator('.ps-newgame-saved-row')).toHaveCount(1);
  expect(await noSideways()).toBe(true);
});

/**
 * Round 89 (H4h), the layout findings of the wave-tester: the open format list brings its footnote into the dialog's view, Start
 * stays in view while two long problem lists scroll the dialog, the menu of 20 saved games scrolls inside the window, and the
 * title's "New game" tag keeps its words at 390 px while the format tag gives way.
 */
test('layout: the format list, Start under long problem lists, the 20-game menu and the New game tag at 390 px', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'New game' }).click();
  const dialog = page.getByRole('dialog', { name: 'New game' });
  await dialog.getByRole('button', { name: /^Format / }).click();
  const footnote = dialog.locator('.ps-format-count');
  await expect(footnote).toBeVisible();
  const within = async () => {
    const box = await footnote.boundingBox();
    const frame = await dialog.boundingBox();
    return box!.y + box!.height <= frame!.y + frame!.height + 1;
  };
  await expect.poll(within).toBe(true);
  await page.keyboard.press('Escape');

  // two teams of banned bodies: each box lists many problems, and the window is short
  await page.setViewportSize({ width: 1400, height: 560 });
  const banned = ['Mewtwo', 'Koraidon', 'Miraidon', 'Zacian', 'Eternatus', 'Arceus'].map(name => `${name}\n- Protect\n- Earthquake\n- Return\n- Substitute`).join('\n\n');
  await dialog.getByRole('textbox', { name: 'Player 1 team' }).fill(banned);
  await dialog.getByRole('textbox', { name: 'Player 2 team' }).fill(banned);
  await expect(dialog.locator('.ps-newgame-problems').first()).toBeVisible({ timeout: 60_000 });
  await expect(dialog.getByRole('button', { name: 'Start' })).toBeInViewport();
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  // the menu of 20 saved games
  await page.setViewportSize({ width: 1400, height: 900 });
  await startGame(page, null, ['Tidepool', 'Marrowkid']);
  await page.evaluate(() => {
    const key = 'ps-replay-interceptor:games';
    const rows = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown[];
    for (let index = 0; rows.length < 20; index += 1) {
      rows.push({ id: `newgame-filler${index}`, formatName: '[Gen 9] OU', players: [`Ann${index}`, `Ben${index}`], turns: index, updatedAt: new Date(2026, 10, 1, 12, index).toISOString(), seed: '1,2,3,4' });
    }
    localStorage.setItem(key, JSON.stringify(rows));
  });
  await page.locator('.ps-loader-toggle').click();
  const panel = page.locator('.ps-loader-panel');
  await panel.getByRole('button', { name: 'Show all 20 saved games' }).click();
  await expect(panel.locator('.ps-newgame-saved-row')).toHaveCount(20);
  const panelBox = await panel.boundingBox();
  expect(panelBox!.y + panelBox!.height).toBeLessThanOrEqual(900);
  expect(await panel.evaluate(element => element.scrollHeight > element.clientHeight && getComputedStyle(element).overflowY === 'auto')).toBe(true);
  await page.keyboard.press('Escape');

  // 390 px: the tag keeps its words beside a long format name (VGC's)
  await page.setViewportSize({ width: 390, height: 844 });
  await startGame(page, { search: 'VGC 2025 Reg I', name: '[Gen 9] VGC 2025 Reg I' }, ['Tidepool', 'Marrowkid']);
  const tag = page.locator('.ps-topbar .ps-newgame-tag');
  await expect(tag).toBeVisible();
  expect(await tag.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
});

/**
 * H6: one whole game per family, the way a draft-league player plays it: paste both teams, Start, pick the leads (four of six in VGC),
 * a turn by hand, a turn the engine fills (the dock's own fill, light engine settings), the slider's end growing by one per turn, a
 * variation at turn 1 whose link a fresh browser opens, the way back to the main line with the replace confirm, Analyze game on the
 * result, the save, and the reload and the saved list that bring the game back on the same turn.
 */
interface GameKind {
  name: string;
  format: { search: string; name: string } | null;
  formatName: string;
  brings: number | null;
  slots: DockSlotKey[];
}

const DOUBLES_SLOTS_OF_GAME: DockSlotKey[] = ['p1a', 'p1b', 'p2a', 'p2b'];
const GAME_KINDS: GameKind[] = [
  { name: 'Gen 9 OU', format: null, formatName: '[Gen 9] OU', brings: null, slots: ['p1a', 'p2a'] },
  { name: 'Doubles OU', format: { search: 'doubles ou', name: '[Gen 9] Doubles OU' }, formatName: '[Gen 9] Doubles OU', brings: 2, slots: DOUBLES_SLOTS_OF_GAME },
  { name: 'VGC, four of six', format: { search: 'vgc 2025', name: '[Gen 9] VGC 2025 Reg I' }, formatName: '[Gen 9] VGC 2025 Reg I', brings: 4, slots: DOUBLES_SLOTS_OF_GAME },
  {
    name: 'Champions VGC, four of six', format: { search: 'champions vgc', name: '[Gen 9 Champions] VGC 2026 Reg M-C' },
    formatName: '[Gen 9 Champions] VGC 2026 Reg M-C', brings: 4, slots: DOUBLES_SLOTS_OF_GAME,
  },
];

const sliderOf = async (page: Page) => {
  const state = await timelineState(page);
  return { value: Number(state.value), max: Number(state.max) };
};

for (const kind of GAME_KINDS) {
  test(`whole game, ${kind.name}: paste, leads, a turn by hand and one by the engine, a variation and the way back, Analyze game, save, reload, the saved list and a shared link`, async ({ page, browser }) => {
    test.setTimeout(1_200_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    await startGame(page, kind.format, ['Tidepool', 'Marrowkid']);
    await expect(page.locator('.ps-topbar').getByText(kind.formatName)).toBeVisible();
    await playLeads(page, kind.brings);
    const atStart = await sliderOf(page);
    expect(atStart.value).toBe(atStart.max);

    // turn 1 by hand: every slot protects, so the turn cannot end the game
    for (const slot of kind.slots) await pickMove(page, slot, 'Protect');
    await page.locator('.ps-dock .ps-execute-btn').click();
    await expect(page.getByText('T2/')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByRole('button', { name: 'Discard variation' })).toHaveCount(0);
    expect(await sliderOf(page)).toEqual({ value: atStart.max + 1, max: atStart.max + 1 });

    // turn 2 by the engine: the dock fills the untouched chips, Execute plays them
    for (const slot of kind.slots) await expect(dockChip(page, slot)).toHaveAttribute('data-origin', 'engine', { timeout: 300_000 });
    await page.locator('.ps-dock .ps-execute-btn').click();
    await expect(page.getByText('T3/')).toBeVisible({ timeout: 300_000 });
    await expect(page.getByRole('button', { name: 'Discard variation' })).toHaveCount(0);
    expect(await sliderOf(page)).toEqual({ value: atStart.max + 2, max: atStart.max + 2 });
    const mainTip = atStart.max + 2;
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('ps-replay-interceptor:games') ?? '[]')[0]?.turns)).toBe(2);

    // a variation at turn 1: the main line keeps its length
    await moveTimeline(page, 1);
    await startVariationAt(page, 1);
    const history = page.locator('.ps-panel', { hasText: 'Variation moves' });
    await expect(history).toContainText('Turn 1');
    await expect(page.getByRole('button', { name: 'Discard variation' })).toBeVisible();
    expect((await sliderOf(page)).max).toBe(mainTip);

    // its link opens the same main line and branch in a fresh browser
    const sharer = await timelineState(page);
    const link = await copiedLink(page);
    const fresh = await openInFreshContext(browser, link);
    try {
      await expect(fresh.page.locator('.ps-topbar').getByText('New game', { exact: true })).toBeVisible({ timeout: 180_000 });
      await expect(fresh.page.locator('.ps-panel', { hasText: 'Variation moves' })).toContainText('Turn 1', { timeout: 180_000 });
      await expect.poll(() => timelineState(fresh.page), { timeout: 60_000 }).toEqual(sharer);
      await expect.poll(() => new URL(fresh.page.url()).hash).toBe('');
    } finally {
      await fresh.close();
    }

    // back to the main line and its tip; a turn played there replaces the variation after the confirm and joins the main line
    await page.locator('.ps-line-chip button', { hasText: 'Main line' }).click();
    await moveTimeline(page, mainTip);
    await expect(page.getByText(`T${mainTip}/`)).toBeVisible();
    for (const slot of kind.slots) await pickMove(page, slot, 'Protect');
    await page.locator('.ps-dock .ps-execute-btn').click();
    const confirm = page.locator('[role="alertdialog"]');
    await expect(confirm).toContainText('replace the existing variation from turn 1');
    await confirm.locator('button', { hasText: 'Replace' }).click();
    await expect(page.getByText(`T${mainTip + 1}/`)).toBeVisible({ timeout: 300_000 });
    await expect(page.locator('.ps-panel', { hasText: 'Variation moves' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Discard variation' })).toHaveCount(0);
    expect(await sliderOf(page)).toEqual({ value: mainTip + 1, max: mainTip + 1 });

    // Analyze game grades the played turns
    const panel = page.locator('.ps-main-right .ps-eval-panel');
    await panel.locator('button', { hasText: 'Analyze game' }).click();
    await expect(panel.locator('button', { hasText: 'Re-analyze' })).toBeVisible({ timeout: 600_000 });
    const swept = await page.evaluate(() => {
      const debug = (window as unknown as { __psDebug?: { graph: { scores: unknown[]; evalErrors: unknown[] } } }).__psDebug;
      return { scores: debug?.graph.scores.filter(score => score !== null).length ?? 0, errors: debug?.graph.evalErrors.filter(message => message !== null).length ?? -1 };
    });
    expect(swept.scores).toBeGreaterThanOrEqual(3);
    expect(swept.errors).toBe(0);
    await panel.locator('.ps-eval-graph rect[data-turn="1"]').click();
    await expect(panel.locator('.ps-eval-bar')).toBeVisible({ timeout: 120_000 });

    // saved after every finished turn, three of them; the address names the game and a reload brings it back on its tip
    await expect.poll(() => page.evaluate(() => {
      const row = JSON.parse(localStorage.getItem('ps-replay-interceptor:games') ?? '[]')[0];
      return row ? `${row.turns} ${row.formatName}` : null;
    })).toBe(`3 ${kind.formatName}`);
    await moveTimeline(page, mainTip + 1);
    await page.reload();
    await expect(page.locator('.ps-topbar').getByText('New game', { exact: true })).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText(`T${mainTip + 1}/`)).toBeVisible({ timeout: 120_000 });
    expect(await sliderOf(page)).toEqual({ value: mainTip + 1, max: mainTip + 1 });

    // and the start page's saved list opens it on the same turn
    await page.goto('/');
    const row = page.locator('.ps-entry-landing .ps-newgame-saved-row');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('3 turns played');
    await row.getByRole('button', { name: 'Open' }).click();
    await expect(page.getByText(`T${mainTip + 1}/`)).toBeVisible({ timeout: 120_000 });
    expect(await sliderOf(page)).toEqual({ value: mainTip + 1, max: mainTip + 1 });
  });
}
