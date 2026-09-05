import { expect, type Frame, type Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import type { ReplayData } from '@fulllifegames/replay-core';
import { doublesReplay } from './fixtures/doubles-replay';
import { vgcReplay } from './fixtures/vgc-replay';
import { emptySmogon, routeSmogon } from './smogon-routes';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** A file under e2e/fixtures by name. */
export const fixturePath = (name: string) => join(__dirname, 'fixtures', name);

/** The singles fixture replay the offline routes serve by default. */
export const fixtureReplay: ReplayData = JSON.parse(readFileSync(fixturePath('replay.json'), 'utf-8'));

export type ReplayWindow = Window & {
  Replays?: {
    battle?: {
      turn?: number;
      currentStep?: number;
      paused?: boolean;
      seeking?: number | null;
      viewpointSwitched?: boolean;
    };
  };
  __psPostedMessages?: unknown[];
};

export async function expectReplayTurn(
  frame: Frame,
  turn: number,
) {
  // The embed script loads from play.pokemonshowdown.com; under full-suite
  // load it can take a while before Replays.battle exists at all — wait for
  // readiness first so slow CDN responses don't eat the turn timeout (G25).
  await expect.poll(async () => frame.evaluate(() =>
    !!(window as ReplayWindow).Replays?.battle
  ), { timeout: 30_000 }).toBe(true);
  await expect.poll(async () => frame.evaluate(() =>
    (window as ReplayWindow).Replays?.battle?.turn ?? -1
  ), { timeout: 15_000 }).toBe(turn);
}

/** Like expectReplayTurn, but tolerant of live-append animation timing: the
 *  appended turn may still be playing, so the battle only needs to have
 *  REACHED the turn (it settles at the log's end on its own). */
export async function expectReplayTurnAtLeast(frame: Frame, turn: number) {
  await expect.poll(async () => frame.evaluate(() =>
    !!(window as ReplayWindow).Replays?.battle
  ), { timeout: 30_000 }).toBe(true);
  await expect.poll(async () => frame.evaluate(() =>
    (window as ReplayWindow).Replays?.battle?.turn ?? -1
  ), { timeout: 30_000 }).toBeGreaterThanOrEqual(turn);
}

/**
 * Unified-timeline helper: moves the slider to `turn`, picks a move for both
 * sides from the ALWAYS-visible pickers (variant B), executes, and waits for
 * the rebuilt sim's history entry — after this a live variation covers
 * `turn` and the pointer sits on its tip.
 */
export async function startVariationAt(page: Page, turn: number, options?: { p1Move?: string | RegExp }) {
  if (turn > 1) {
    await page.locator('.ps-branch-bar input[type="range"]').fill(String(turn));
    await expect(page.getByText(`T${turn}/`)).toBeVisible();
  }
  const p1 = page.locator('.ps-branch-side-column').first();
  const p2 = page.locator('.ps-branch-side-column').nth(1);
  if (options?.p1Move) {
    await p1.locator('.ps-movebtn', { hasText: options.p1Move }).click();
  } else {
    await p1.locator('.ps-movebtn:enabled').first().click();
  }
  await p2.locator('.ps-movebtn:enabled').first().click();
  await page.locator('.ps-execute-btn').click();
  await expect(page.locator('.ps-panel', { hasText: 'Variation moves' }))
    .toContainText(`Turn ${turn}`, { timeout: 60_000 });
  // A first-move KO is common — resolve the trailing forced replacement so
  // callers always get both sides' pickers back. The compact picker shows
  // switch chips at every position, so the forced state is detected via its
  // prompt, never via mere switch-button visibility.
  const forcedNote = page.locator('.ps-force-switch-note').first();
  await forcedNote.waitFor({ state: 'visible', timeout: 4000 }).catch(() => {});
  if (await forcedNote.isVisible().catch(() => false)) {
    const forcedControls = page.locator('.ps-side-controls', { has: page.locator('.ps-force-switch-note') }).first();
    await forcedControls.locator('.ps-switchbtn:enabled').first().click();
    await expect(page.locator('.ps-panel', { hasText: 'Variation moves' }))
      .toContainText('forced replacement', { timeout: 30_000 });
  }
  for (const side of [p1, p2]) {
    await expect(side.locator('.ps-movebtn').first()).toBeVisible({ timeout: 30_000 });
  }
}

/** Waits for the dwell upgrade: after ~1s on a main-line turn the app
 *  reconstructs the exact position in the background and the snapshot
 *  approximation upgrades in place (no button — the unified timeline's
 *  exactness promise). */
export async function waitForExactPickers(page: Page, turn?: number) {
  if (turn && turn > 1) {
    await page.locator('.ps-branch-bar input[type="range"]').fill(String(turn));
    await expect(page.getByText(`T${turn}/`)).toBeVisible();
  }
  await expect(page.getByText('Choices from the reconstructed position')).toBeVisible({ timeout: 90_000 });
}

// The embed script is fetched from play.pokemonshowdown.com by every test's
// iframe; occasional CDN stalls were the root of the flaky `Replays.battle`
// timeouts (G25). Fetch it once per file and serve all its tests from memory.
let replayEmbedCache: Buffer | null = null;

/** Fills the embed cache; every spec file calls it from its own `test.beforeAll`. */
export async function installReplayEmbedCache(): Promise<void> {
  try {
    const response = await fetch('https://play.pokemonshowdown.com/js/replay-embed.js');
    if (response.ok) replayEmbedCache = Buffer.from(await response.arrayBuffer());
  } catch {
    // Fall through — tests then hit the CDN directly like before.
  }
}

/** The offline routes every dashboard test starts from: cached replay embed, fixture replays, empty Smogon data. */
export async function routeOfflineFixtures(page: Page): Promise<void> {
  await page.route('**/play.pokemonshowdown.com/js/replay-embed.js*', async (route) => {
    if (replayEmbedCache) {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: replayEmbedCache,
      });
      return;
    }
    await route.continue().catch(() => {});
  });
  await page.route('**/replay.pokemonshowdown.com/**', (route) => {
    const url = route.request().url();
    const replay = url.includes(vgcReplay.id) ? vgcReplay
      : url.includes(doublesReplay.id) ? doublesReplay
      : fixtureReplay;
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(replay),
    });
  });
  await routeSmogon(page, emptySmogon);
}
