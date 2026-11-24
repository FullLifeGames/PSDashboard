import { test, expect, type Page } from '@playwright/test';
import { installReplayEmbedCache, pickMove, moveTimeline, startVariationAt } from './helpers';
import { copiedLink, openInFreshContext, prepare, timelineState } from './new-game-helpers';

test.beforeAll(installReplayEmbedCache);

const SIX = ['Garchomp', 'Gengar', 'Dragonite', 'Tyranitar', 'Snorlax', 'Starmie'];
const team = (species: string[]) => species.map(name => `${name}\nEVs: 4 HP\n- Protect\n- Earthquake\n- Return\n- Substitute`).join('\n\n');

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

async function playProtectTurn(page: Page, slots: ('p1a' | 'p1b' | 'p2a' | 'p2b')[], reaches: number): Promise<void> {
  for (const slot of slots) await pickMove(page, slot, 'Protect');
  await page.locator('.ps-dock .ps-execute-btn').click();
  await expect(page.getByText(`T${reaches}/`)).toBeVisible({ timeout: 90_000 });
}

async function expectOpenedLikeTheSharer(page: Page, sharer: Awaited<ReturnType<typeof timelineState>>, seed: string): Promise<void> {
  await expect(page.locator('.ps-topbar').getByText('New game', { exact: true })).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('.ps-panel', { hasText: 'Variation moves' })).toBeVisible({ timeout: 120_000 });
  await expect.poll(() => timelineState(page), { timeout: 60_000 }).toEqual(sharer);
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
