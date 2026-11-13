import { test, expect, type Browser, type Page } from '@playwright/test';
import { installReplayEmbedCache, routeOfflineFixtures, pickMove, moveTimeline, startVariationAt } from './helpers';
import { lightEngine } from './dock-helpers';
import { encodeBranchShare } from '../../src/lib/branch-share';
import { sharedBranchPayload } from './fixtures/shared-branch';

/**
 * Round 89 (lane H, #105), stage H5: the share link of a game and the state file of a game, in the browser. A player copies the
 * link in the middle of a game (the main line, a variation, a turn he stands on) and a teammate opens it in a fresh browser
 * context: the same main line, the same variation, the same turn, the seed in the saved list. A version 1 link (a replay's
 * branch) opens as before, and a game's state file restores the game on a fresh page. Singles (Gen 9 OU) and VGC (doubles type).
 */
test.beforeAll(installReplayEmbedCache);

const SIX = ['Garchomp', 'Gengar', 'Dragonite', 'Tyranitar', 'Snorlax', 'Starmie'];
const team = (species: string[]) => species.map(name => `${name}\nEVs: 4 HP\n- Protect\n- Earthquake\n- Return\n- Substitute`).join('\n\n');

async function prepare(page: Page): Promise<void> {
  await lightEngine(page);
  await routeOfflineFixtures(page);
}

async function startGame(page: Page, format: { search: string; name: string } | null): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'New game' }).click();
  const dialog = page.getByRole('dialog', { name: 'New game' });
  if (format) {
    await dialog.getByRole('button', { name: /^Format / }).click();
    await dialog.getByRole('combobox', { name: 'Search formats' }).fill(format.search);
    await dialog.getByRole('option').filter({ has: page.locator('span:first-child', { hasText: new RegExp(`^${format.name.replace(/[[\]()]/g, '\\$&')}$`) }) }).first().click();
  }
  await dialog.getByRole('textbox', { name: 'Player 1 name' }).fill('Tidepool');
  await dialog.getByRole('textbox', { name: 'Player 2 name' }).fill('Marrowkid');
  await dialog.getByRole('textbox', { name: 'Player 1 team' }).fill(team(SIX));
  await dialog.getByRole('textbox', { name: 'Player 2 team' }).fill(team(SIX));
  await expect(dialog.getByText('6 of 6 sets read')).toHaveCount(2);
  await expect(dialog.getByRole('button', { name: 'Start' })).toBeEnabled({ timeout: 60_000 });
  await dialog.getByRole('button', { name: 'Start' }).click();
  await expect(dialog).toBeHidden({ timeout: 60_000 });
}

async function playLeads(page: Page, brings: number | null): Promise<void> {
  const lead = page.locator('.ps-lead');
  await expect(lead).toBeVisible({ timeout: 90_000 });
  for (const side of [0, 1]) {
    const tiles = lead.locator('.ps-lead-side').nth(side).locator('.ps-switchbtn');
    for (let pick = 0; pick < (brings ?? 1); pick += 1) await tiles.nth(pick).click();
  }
  await lead.locator('.ps-execute-btn', { hasText: 'Play from turn 0' }).click();
  await expect(page.locator('.ps-dock-chip').first()).toBeVisible({ timeout: 90_000 });
}

/** One turn at the tip: every slot protects (a turn that cannot end the game), then Execute. */
async function playProtectTurn(page: Page, slots: ('p1a' | 'p1b' | 'p2a' | 'p2b')[], reaches: number): Promise<void> {
  for (const slot of slots) await pickMove(page, slot, 'Protect');
  await page.locator('.ps-dock .ps-execute-btn').click();
  await expect(page.getByText(`T${reaches}/`)).toBeVisible({ timeout: 90_000 });
}

/** The link the Copy Share Link button writes into its field. */
async function copiedLink(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Copy Share Link' }).click();
  const field = page.getByLabel('Branch share link');
  await expect(field).toHaveValue(/#branch=/);
  return field.inputValue();
}

const timelineState = (page: Page) => page.locator('.ps-branch-bar input[type="range"]').evaluate(input => {
  const range = input as HTMLInputElement;
  return { value: range.value, max: range.max };
});

/** A fresh browser context (no storage of the sharer) that opens the link. */
async function openInFreshContext(browser: Browser, link: string): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();
  await prepare(page);
  await page.goto(link);
  return { page, close: () => context.close() };
}

async function expectOpenedLikeTheSharer(page: Page, sharer: Awaited<ReturnType<typeof timelineState>>, seed: string): Promise<void> {
  await expect(page.locator('.ps-topbar').getByText('New game', { exact: true })).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('.ps-panel', { hasText: 'Variation moves' })).toBeVisible({ timeout: 120_000 });
  await expect.poll(() => timelineState(page), { timeout: 60_000 }).toEqual(sharer);
  // the hash is gone, the address names the copy, and the game is saved in the new browser with the sharer's seed
  await expect.poll(() => new URL(page.url()).hash).toBe('');
  await expect(page).toHaveURL(/[?&]game=newgame-/);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('ps-replay-interceptor:games') ?? '[]')[0]?.seed)).toBe(seed);
  await page.locator('.ps-loader-toggle').click();
  await expect(page.locator('.ps-loader-panel .ps-newgame-saved-row')).toContainText(`Seed ${seed}`);
  await page.keyboard.press('Escape');
}

test('Gen 9 OU: the link of a game in the middle of a variation opens the same main line, branch and turn in a fresh context, with the sharer\'s seed', async ({ page, browser }) => {
  test.setTimeout(480_000);
  await page.setViewportSize({ width: 1366, height: 768 });
  await prepare(page);
  await startGame(page, null);
  await playLeads(page, null);
  await playProtectTurn(page, ['p1a', 'p2a'], 2);
  await playProtectTurn(page, ['p1a', 'p2a'], 3);
  // a variation from turn 2: another move than the game's own
  await moveTimeline(page, 2);
  await startVariationAt(page, 2, { p1Move: 'Earthquake' });
  await expect(page.locator('.ps-panel', { hasText: 'Variation moves' })).toContainText('Turn 2');
  const sharer = await timelineState(page);
  const seed = await page.evaluate(() => JSON.parse(localStorage.getItem('ps-replay-interceptor:games') ?? '[]')[0].seed as string);
  const link = await copiedLink(page);

  const fresh = await openInFreshContext(browser, link);
  try {
    await expectOpenedLikeTheSharer(fresh.page, sharer, seed);
    await expect(fresh.page.locator('.ps-panel', { hasText: 'Variation moves' })).toContainText('Turn 2');
  } finally {
    await fresh.close();
  }
});

test('Scarlet/Violet VGC: the link carries the four brought bodies, the main line and the open branch; the same link opens once and a reload keeps the game', async ({ page, browser }) => {
  test.setTimeout(480_000);
  await page.setViewportSize({ width: 1366, height: 768 });
  await prepare(page);
  await startGame(page, { search: 'vgc 2025', name: '[Gen 9] VGC 2025 Reg I' });
  await playLeads(page, 4);
  await playProtectTurn(page, ['p1a', 'p1b', 'p2a', 'p2b'], 2);
  await moveTimeline(page, 1);
  await startVariationAt(page, 1);
  await expect(page.locator('.ps-panel', { hasText: 'Variation moves' })).toContainText('Turn 1');
  const sharer = await timelineState(page);
  const seed = await page.evaluate(() => JSON.parse(localStorage.getItem('ps-replay-interceptor:games') ?? '[]')[0].seed as string);
  const link = await copiedLink(page);
  // a doubles link stays short: two teams of six, the leads and the choices
  expect(link.length).toBeLessThan(8000);

  const fresh = await openInFreshContext(browser, link);
  try {
    await expectOpenedLikeTheSharer(fresh.page, sharer, seed);
    await expect.poll(() => fresh.page.evaluate(() => JSON.parse(localStorage.getItem('ps-replay-interceptor:games') ?? '[]').length)).toBe(1);
    const address = fresh.page.url();
    await fresh.page.reload();
    expect(fresh.page.url()).toBe(address);
    await expect(fresh.page.locator('.ps-topbar').getByText('New game', { exact: true })).toBeVisible({ timeout: 120_000 });
  } finally {
    await fresh.close();
  }
});

test('a version 1 link of a replay branch opens its read-only view as before; one of a game offers no Load Original Replay', async ({ page }) => {
  await routeOfflineFixtures(page);
  await page.goto(`/#branch=${encodeBranchShare(sharedBranchPayload)}`);
  await expect(page.getByText('Shared Branch', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Load Original Replay' })).toBeVisible();
  await page.goto(`/#branch=${encodeBranchShare({ ...sharedBranchPayload, replayId: 'newgame-m7nj3hx23e' })}`);
  await page.reload();
  await expect(page.getByText('Shared Branch', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'New Replay' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Load Original Replay' })).toHaveCount(0);
});

test('a link of a newer version names its version; a damaged game link says so', async ({ page }) => {
  await routeOfflineFixtures(page);
  await page.goto(`/#branch=${Buffer.from(JSON.stringify({ version: 3 })).toString('base64url')}`);
  await expect(page.getByRole('alert')).toContainText('newer PS Dashboard (link version 3)');
  await page.goto(`/#branch=${Buffer.from(JSON.stringify({ version: 2, kind: 'game' })).toString('base64url')}`);
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('invalid or damaged');
});

type StateHandle = { capture: () => Promise<Record<string, unknown>>; restore: (state: unknown) => Promise<void> };

test('the state file of a game restores the game on a fresh page; its issue link names the game', async ({ page, browser }) => {
  test.setTimeout(360_000);
  await page.setViewportSize({ width: 1366, height: 768 });
  await prepare(page);
  await startGame(page, null);
  await playLeads(page, null);
  await playProtectTurn(page, ['p1a', 'p2a'], 2);
  const state = await page.evaluate(() => (window as unknown as { __psState: StateHandle }).__psState.capture());
  const game = state.game as { id: string; seed: string; turns: number };
  expect(state.version).toBe(1);
  expect(game.turns).toBe(1);
  expect((state.replay as { id: string }).id).toBe(game.id);
  // the issue link names the game, with no Showdown replay behind it
  await page.locator('.ps-topbar').getByRole('button', { name: 'Report issue' }).click();
  const href = await page.getByRole('link', { name: 'Open the issue on GitHub' }).getAttribute('href');
  expect(new URL(href!).searchParams.get('replay')).toBe(`New game ${game.id}, [Gen 9] OU, seed ${game.seed}, 1 turn played (no Showdown replay)`);

  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const fresh = await context.newPage();
  try {
    await prepare(fresh);
    await fresh.goto('/');
    await fresh.evaluate(saved => (window as unknown as { __psState: StateHandle }).__psState.restore(saved), state);
    await expect(fresh.locator('.ps-topbar').getByText('New game', { exact: true })).toBeVisible({ timeout: 120_000 });
    await expect(fresh.getByText('T2/')).toBeVisible({ timeout: 90_000 });
    await expect(fresh).toHaveURL(new RegExp(`[?&]game=${game.id}`));
  } finally {
    await context.close();
  }
});
