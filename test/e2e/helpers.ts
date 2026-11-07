import { expect, type Frame, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import type { ReplayData } from '@fulllifegames/replay-core';
import { doublesForcedReplay, doublesReplay, doublesSpreadReplay } from './fixtures/doubles-replay';
import { vgcReplay } from './fixtures/vgc-replay';
import { emptySmogon, routeSmogon } from './smogon-routes';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** A file under test/e2e/fixtures by name. */
export const fixturePath = (name: string) => join(__dirname, 'fixtures', name);

/** The singles fixture replay the offline routes serve by default. */
export const fixtureReplay: ReplayData = JSON.parse(readFileSync(fixturePath('replay.json'), 'utf-8'));

export type ReplayWindow = Window & {
  Replays?: {
    /** The embed's own music flag: false at load, then true once its update sees the muted `BattleSound` (round 88, T316). */
    muted?: boolean;
    battle?: {
      turn?: number;
      currentStep?: number;
      paused?: boolean;
      seeking?: number | null;
      atQueueEnd?: boolean;
      viewpointSwitched?: boolean;
      /** The side the frame shows near: Switch sides and the ?p2 flag set it (round 88, T316). */
      nearSide?: { sideid?: string } | null;
      messageFadeTime?: number;
    };
  };
  BattleSound?: { muted?: boolean };
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
 * Waits until the frame has played everything it holds: no seek running and the battle at the end of its steps (T280,
 * T281). Until then the frame plays its turn in, and the app repeats a seek for 1.2 s (`useReplayFrame`), so a reading
 * or a click before that races the frame, and a slow runner loses the race.
 */
export async function expectReplaySettled(frame: Frame) {
  await expect.poll(() => frame.evaluate(() => {
    const battle = (window as ReplayWindow).Replays?.battle;
    return !!battle && battle.seeking === null && battle.atQueueEnd === true;
  }), { timeout: 60_000 }).toBe(true);
}

/** The four slots a chip can stand for: side and field position. A singles game has `p1a` and `p2a` only. */
export type DockSlotKey = 'p1a' | 'p1b' | 'p2a' | 'p2b';

/** Round 84 (turn dock): the chip of one slot. Its `data-chip` is the side and the slot index (`p10`, `p11`, `p20`, `p21`). */
export const dockChip = (page: Page, slot: DockSlotKey): Locator =>
  page.locator(`.ps-dock-chip[data-chip="${slot.slice(0, 2)}${slot[2] === 'a' ? 0 : 1}"]`);

/** The tray above the dock; only one is open at a time. */
export const dockTray = (page: Page): Locator => page.locator('.ps-tray');

/** The slot a chip's `data-chip` names (`p21` is `p2b`). */
const slotOfChip = (raw: string): DockSlotKey => `${raw.slice(0, 2)}${raw[2] === '0' ? 'a' : 'b'}` as DockSlotKey;

interface TrayOptions {
  /** For a retry loop: the clicks and the checks give up after this time (a stale dock takes no input). */
  timeout?: number;
}

/** Opens a chip's tray and waits until it stands; a chip that is the open one stays open (the chip itself toggles). */
async function openChip(page: Page, chip: Locator, { timeout }: TrayOptions = {}): Promise<Locator> {
  if ((await chip.getAttribute('aria-expanded', { timeout })) !== 'true') await chip.click({ timeout });
  await expect(chip).toHaveAttribute('aria-expanded', 'true', { timeout });
  return dockTray(page);
}

/** Round 84 (turn dock): opens the tray of one slot. A tray that stands for this slot already stays as it is. */
export function openTray(page: Page, slot: DockSlotKey, options?: TrayOptions): Promise<Locator> {
  return openChip(page, dockChip(page, slot), options);
}

/** Opens the slot's tray and its "Dice · What if" section (the dice, the What-if loader and all choices). */
export async function openTrayMore(page: Page, slot: DockSlotKey, options?: TrayOptions): Promise<Locator> {
  const tray = await openTray(page, slot, options);
  const toggle = tray.getByRole('button', { name: /Dice · What if/ });
  if ((await toggle.getAttribute('aria-expanded', { timeout: options?.timeout })) !== 'true') await toggle.click({ timeout: options?.timeout });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true', { timeout: options?.timeout });
  return tray;
}

/**
 * Round 84 (turn dock): picks a move of one slot in its tray: the named one, else the first enabled one (what the old column
 * helper took). The tile click makes it the slot's own choice (a draft entry), so the executed turn names this move in this
 * slot whatever the seed was. Returns the move's name once the chip shows it.
 */
export async function pickMove(page: Page, slot: DockSlotKey, move?: string | RegExp, options?: TrayOptions): Promise<string> {
  const tray = await openTray(page, slot, options);
  const tile = move ? tray.locator('.ps-movebtn', { hasText: move }) : tray.locator('.ps-movebtn:enabled').first();
  const name = ((await tile.locator('.ps-movebtn-name').first().textContent({ timeout: options?.timeout })) ?? '').trim();
  await tile.click({ timeout: options?.timeout });
  await expect(dockChip(page, slot)).toContainText(name, { timeout: options?.timeout });
  return name;
}

/** Picks a switch tile of one slot's tray, by the body's name. */
export async function pickSwitch(page: Page, slot: DockSlotKey, body: string | RegExp, options?: TrayOptions): Promise<void> {
  const tray = await openTray(page, slot, options);
  await tray.locator('.ps-switchbtn', { hasText: body }).click({ timeout: options?.timeout });
}

/**
 * The forced replacement the position asks of a slot (its chip carries `data-forced`): opens the chip's bench and sends
 * the first body that may enter. The pick executes at once, whatever the engine's fill holds for the slot.
 */
export async function pickForcedReplacement(page: Page, options?: TrayOptions): Promise<void> {
  // Round 84 (A7a): the engine fills the forced slot too, so its chip no longer reads "choose a replacement"; the chip carries data-forced.
  const tray = await openChip(page, page.locator('.ps-dock-chip[data-forced="true"]:not([inert])').first(), options);
  await tray.locator('.ps-switchbtn:enabled').first().click({ timeout: options?.timeout });
}

/**
 * Round 84 (A7e): moves the timeline slider to `turn`. Chromium takes `fill()` on the range input, as every spec did before. WebKit's
 * range input does not take it (the A7d run: "T5/" never showed in WebKit through `fill()`, while a click with the pointer moved the
 * slider), so there the helper clicks the track where the turn lies (the thumb is about 16 px wide, so the click may land a turn
 * or two off) and settles on the turn with the arrow keys, which the input handles natively.
 */
export async function moveTimeline(page: Page, turn: number): Promise<void> {
  const slider = page.locator('.ps-branch-bar input[type="range"]');
  if (page.context().browser()?.browserType().name() !== 'webkit') {
    await slider.fill(String(turn));
    return;
  }
  await slider.scrollIntoViewIfNeeded();
  const { min, max } = await slider.evaluate(input => ({ min: Number((input as HTMLInputElement).min), max: Number((input as HTMLInputElement).max) }));
  const box = (await slider.boundingBox())!;
  const thumb = 16;
  const ratio = max > min ? (turn - min) / (max - min) : 0;
  await page.mouse.click(box.x + thumb / 2 + ratio * (box.width - thumb), box.y + box.height / 2);
  for (let presses = 0; presses < max - min + 2; presses++) {
    const value = Number(await slider.inputValue());
    if (value === turn) return;
    await slider.press(value < turn ? 'ArrowRight' : 'ArrowLeft');
  }
  expect(Number(await slider.inputValue()), `the slider after the pointer and the arrow keys (range ${min} to ${max})`).toBe(turn);
}

/**
 * Unified-timeline helper: moves the slider to `turn`, gives EVERY active slot an explicit move through its tray, executes,
 * and waits for the rebuilt sim's history entry: after this a live variation covers `turn` and the pointer sits on its tip.
 *
 * Round 84 (turn dock): the slots start with the logged choice, so the helper picks in every slot the move the old column
 * helper took (the first enabled one; `p1Move` for the first P1 slot), and the executed turn stays the one the specs always
 * executed. The explicit pick also fills a slot with no logged action (a flinch, a faint before the move), which would hold
 * Execute locked.
 */
export async function startVariationAt(page: Page, turn: number, options?: { p1Move?: string | RegExp }) {
  if (turn > 1) {
    await moveTimeline(page, turn);
    await expect(page.getByText(`T${turn}/`)).toBeVisible();
  }
  const chips = page.locator('.ps-dock-chip');
  await expect(chips.first()).toBeVisible({ timeout: 30_000 });
  const slots = (await chips.evaluateAll(elements => elements.map(element => element.getAttribute('data-chip') ?? '')))
    .map(slotOfChip);
  for (const slot of slots) {
    await pickMove(page, slot, slot === slots[0] ? options?.p1Move : undefined);
  }
  await page.locator('.ps-execute-btn').click();
  await expect(page.locator('.ps-panel', { hasText: 'Variation moves' }))
    .toContainText(`Turn ${turn}`, { timeout: 60_000 });
  // A first-move KO is common: resolve the trailing forced replacement so callers always get both sides' pickers back. The
  // chips show at every position, so the forced state is detected via the strip's prompt, never via a chip alone.
  const forcedNote = page.locator('.ps-force-switch-note').first();
  await forcedNote.waitFor({ state: 'visible', timeout: 4000 }).catch(() => {});
  if (await forcedNote.isVisible().catch(() => false)) {
    await pickForcedReplacement(page);
    await expect(page.locator('.ps-panel', { hasText: 'Variation moves' }))
      .toContainText('forced replacement', { timeout: 30_000 });
  }
  for (const slot of slots) {
    await expect(dockChip(page, slot)).toBeVisible({ timeout: 30_000 });
  }
  await expect(page.locator('.ps-force-switch-note')).toHaveCount(0, { timeout: 30_000 });
}

/** Opens the top bar's Setup menu and clicks one of its entries (round 77: the team actions moved there). */
export async function fromSetup(page: Page, entry: string) {
  await page.getByRole('button', { name: 'Setup', exact: true }).click();
  await page.locator('.ps-setup-panel').getByRole('button', { name: entry, exact: true }).click();
}

/** Opens the top bar's Load panel (round 84, Q20 a: once a replay is loaded the loader lives there, not in the column) and returns it. */
export async function openLoader(page: Page): Promise<Locator> {
  await page.locator('.ps-loader-toggle').click();
  const panel = page.locator('.ps-loader-panel');
  await expect(panel).toBeVisible();
  return panel;
}

/** Waits for the dwell upgrade: after ~1s on a main-line turn the app
 *  reconstructs the exact position in the background and the snapshot
 *  approximation upgrades in place (no button — the unified timeline's
 *  exactness promise). */
export async function waitForExactPickers(page: Page, turn?: number) {
  if (turn && turn > 1) {
    await moveTimeline(page, turn);
    await expect(page.getByText(`T${turn}/`)).toBeVisible();
  }
  await expect(page.locator('.ps-dock-status').getByText('Choices from the reconstructed position')).toBeVisible({ timeout: 90_000 });
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

/**
 * Serves the cached embed script late, as a browser gets it from the network: a frame still loads while the app already
 * posts to it (round 77, the appended turn the user never saw). Registered after the offline routes, so it wins.
 */
export async function routeSlowReplayEmbed(page: Page, delayMs: number): Promise<void> {
  await page.route('**/play.pokemonshowdown.com/js/replay-embed.js*', async (route) => {
    await new Promise(resolve => setTimeout(resolve, delayMs));
    if (replayEmbedCache) {
      await route.fulfill({ status: 200, contentType: 'application/javascript', body: replayEmbedCache });
      return;
    }
    await route.continue().catch(() => {});
  });
}

/**
 * Round 84 (turn dock): five corpus games with played turns, byte copies of `.fit-corpus` files. The hand-written doubles and
 * VGC fixtures hold no played turn, so the dock's seed (the logged choice of every slot) needs these. Served by their ids.
 */
export const dockReplays: ReplayData[] = [
  'dock-doublesou-2662153814.json',
  'dock-doublesou-2693620934.json',
  'dock-vgcregi-2573391549.json',
  'dock-championsvgc-2625939941.json',
  'dock-championsvgc-2623421463.json',
].map(name => JSON.parse(readFileSync(fixturePath(name), 'utf-8')) as ReplayData);

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
      : url.includes(doublesSpreadReplay.id) ? doublesSpreadReplay
      : url.includes(doublesForcedReplay.id) ? doublesForcedReplay
      : url.includes(doublesReplay.id) ? doublesReplay
      : dockReplays.find(dock => url.includes(dock.id)) ?? fixtureReplay;
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(replay),
    });
  });
  await routeSmogon(page, emptySmogon);
}
