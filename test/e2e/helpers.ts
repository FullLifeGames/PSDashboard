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

export const fixturePath = (name: string) => join(__dirname, 'fixtures', name);

export const fixtureReplay: ReplayData = JSON.parse(readFileSync(fixturePath('replay.json'), 'utf-8'));

export type ReplayWindow = Window & {
  Replays?: {
    /** The embed's own music flag: false at load, then true once its update sees the muted `BattleSound`. */
    muted?: boolean;
    battle?: {
      turn?: number;
      currentStep?: number;
      paused?: boolean;
      seeking?: number | null;
      atQueueEnd?: boolean;
      viewpointSwitched?: boolean;
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
  await expect.poll(async () => frame.evaluate(() =>
    !!(window as ReplayWindow).Replays?.battle
  ), { timeout: 30_000 }).toBe(true);
  await expect.poll(async () => frame.evaluate(() =>
    (window as ReplayWindow).Replays?.battle?.turn ?? -1
  ), { timeout: 15_000 }).toBe(turn);
}

/** The appended turn may still be playing: the battle only needs to have reached the turn. */
export async function expectReplayTurnAtLeast(frame: Frame, turn: number) {
  await expect.poll(async () => frame.evaluate(() =>
    !!(window as ReplayWindow).Replays?.battle
  ), { timeout: 30_000 }).toBe(true);
  await expect.poll(async () => frame.evaluate(() =>
    (window as ReplayWindow).Replays?.battle?.turn ?? -1
  ), { timeout: 30_000 }).toBeGreaterThanOrEqual(turn);
}

/** Until the frame has played everything, the app repeats a seek for 1.2 s (`useReplayFrame`): reads race it. */
export async function expectReplaySettled(frame: Frame) {
  await expect.poll(() => frame.evaluate(() => {
    const battle = (window as ReplayWindow).Replays?.battle;
    return !!battle && battle.seeking === null && battle.atQueueEnd === true;
  }), { timeout: 60_000 }).toBe(true);
}

export type DockSlotKey = 'p1a' | 'p1b' | 'p2a' | 'p2b';

/** The chip of one slot. Its `data-chip` is the side and the slot index (`p10`, `p11`, `p20`, `p21`). */
export const dockChip = (page: Page, slot: DockSlotKey): Locator =>
  page.locator(`.ps-dock-chip[data-chip="${slot.slice(0, 2)}${slot[2] === 'a' ? 0 : 1}"]`);

export const dockTray = (page: Page): Locator => page.locator('.ps-tray');

const slotOfChip = (raw: string): DockSlotKey => `${raw.slice(0, 2)}${raw[2] === '0' ? 'a' : 'b'}` as DockSlotKey;

interface TrayOptions {
  timeout?: number;
}

// A chip that is the open one stays open: the chip itself toggles.
async function openChip(page: Page, chip: Locator, { timeout }: TrayOptions = {}): Promise<Locator> {
  if ((await chip.getAttribute('aria-expanded', { timeout })) !== 'true') await chip.click({ timeout });
  await expect(chip).toHaveAttribute('aria-expanded', 'true', { timeout });
  return dockTray(page);
}

/** A new game's lead turn is a variation until it joins the main line; a tray opened meanwhile closes. */
export async function expectGameOnMainLine(page: Page): Promise<void> {
  await expect(page.locator('.ps-dock-chip').first()).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole('button', { name: 'Discard variation' })).toHaveCount(0, { timeout: 60_000 });
}

export function openTray(page: Page, slot: DockSlotKey, options?: TrayOptions): Promise<Locator> {
  return openChip(page, dockChip(page, slot), options);
}

export async function openTrayMore(page: Page, slot: DockSlotKey, options?: TrayOptions): Promise<Locator> {
  const tray = await openTray(page, slot, options);
  const toggle = tray.getByRole('button', { name: /Dice · What if/ });
  if ((await toggle.getAttribute('aria-expanded', { timeout: options?.timeout })) !== 'true') await toggle.click({ timeout: options?.timeout });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true', { timeout: options?.timeout });
  return tray;
}

/** The tile click makes it the slot's own choice, so the executed turn names this move whatever the seed was. */
export async function pickMove(page: Page, slot: DockSlotKey, move?: string | RegExp, options?: TrayOptions): Promise<string> {
  const tray = await openTray(page, slot, options);
  const tile = move ? tray.locator('.ps-movebtn', { hasText: move }) : tray.locator('.ps-movebtn:enabled').first();
  const name = ((await tile.locator('.ps-movebtn-name').first().textContent({ timeout: options?.timeout })) ?? '').trim();
  await tile.click({ timeout: options?.timeout });
  await expect(dockChip(page, slot)).toContainText(name, { timeout: options?.timeout });
  return name;
}

export async function pickSwitch(page: Page, slot: DockSlotKey, body: string | RegExp, options?: TrayOptions): Promise<void> {
  const tray = await openTray(page, slot, options);
  await tray.locator('.ps-switchbtn', { hasText: body }).click({ timeout: options?.timeout });
}

export async function pickForcedReplacement(page: Page, options?: TrayOptions): Promise<void> {
  // The engine fills the forced slot too, so its chip never reads "choose a replacement"; it carries data-forced.
  const tray = await openChip(page, page.locator('.ps-dock-chip[data-forced="true"]:not([inert])').first(), options);
  await tray.locator('.ps-switchbtn:enabled').first().click({ timeout: options?.timeout });
}

/** WebKit's range input does not take `fill()`: the helper clicks the track, then settles with the arrow keys. */
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

export async function discardVariation(page: Page, options?: { confirm?: boolean }) {
  // The bar counts a turn only once it has played; a click before that discards without the question.
  await expect(page.getByRole('button', { name: /Variation moves · \d+ turns?/ })).toBeVisible({ timeout: 120_000 });
  await page.locator('.ps-branch-bar').getByRole('button', { name: 'Discard variation' }).click();
  const question = page.getByRole('alertdialog');
  await expect(question).toContainText(/The variation has \d+ played turns?\./);
  await question.getByRole('button', { name: options?.confirm === false ? 'Cancel' : 'Discard variation' }).click();
  await expect(question).toHaveCount(0);
}

/** The explicit pick also fills a slot with no logged action (flinch, faint before the move), which locks Execute. */
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
  // A first-move KO is common: the strip's prompt detects the forced replacement, as the chips show at every position.
  const forcedNote = page.locator('.ps-force-switch-note').first();
  await forcedNote.waitFor({ state: 'visible', timeout: 4000 }).catch(() => {});
  if (await forcedNote.isVisible().catch(() => false)) {
    await pickForcedReplacement(page);
    await expect(page.locator('.ps-panel', { hasText: 'Variation moves' }))
      .toContainText('replacement (', { timeout: 30_000 });
  }
  for (const slot of slots) {
    await expect(dockChip(page, slot)).toBeVisible({ timeout: 30_000 });
  }
  await expect(page.locator('.ps-force-switch-note')).toHaveCount(0, { timeout: 30_000 });
}

export async function fromSetup(page: Page, entry: string) {
  await page.getByRole('button', { name: 'Setup', exact: true }).click();
  await page.locator('.ps-setup-panel').getByRole('button', { name: entry, exact: true }).click();
}

export async function openLoader(page: Page): Promise<Locator> {
  await page.locator('.ps-loader-toggle').click();
  const panel = page.locator('.ps-loader-panel');
  await expect(panel).toBeVisible();
  return panel;
}

/** After about 1 s on a main-line turn the app rebuilds the exact position and upgrades the pickers in place. */
export async function waitForExactPickers(page: Page, turn?: number) {
  if (turn && turn > 1) {
    await moveTimeline(page, turn);
    await expect(page.getByText(`T${turn}/`)).toBeVisible();
  }
  await expect(page.locator('.ps-dock-status').getByText('Choices from the reconstructed position')).toBeVisible({ timeout: 90_000 });
}

let replayEmbedCache: Buffer | null = null;

export async function installReplayEmbedCache(): Promise<void> {
  try {
    const response = await fetch('https://play.pokemonshowdown.com/js/replay-embed.js');
    if (response.ok) replayEmbedCache = Buffer.from(await response.arrayBuffer());
  } catch {
    // Fall through: tests then hit the CDN directly.
  }
}

/** Registered after the offline routes, so it wins. */
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

/** The hand-written doubles and VGC fixtures hold no played turn, which the dock's seed (the logged choices) needs. */
export const dockReplays: ReplayData[] = [
  'dock-doublesou-2662153814.json',
  'dock-doublesou-2693620934.json',
  'dock-vgcregi-2573391549.json',
  'dock-championsvgc-2625939941.json',
  'dock-championsvgc-2623421463.json',
].map(name => JSON.parse(readFileSync(fixturePath(name), 'utf-8')) as ReplayData);

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

export async function readDepth(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Setup' }).click();
  const value = await page.locator('.ps-setup-panel label', { hasText: 'Depth' }).locator('select').inputValue();
  await page.keyboard.press('Escape');
  return value;
}

export async function pickDepth(page: Page, value: '1' | '2' | 'mcts' | 'auto'): Promise<void> {
  await page.getByRole('button', { name: 'Setup' }).click();
  await page.locator('.ps-setup-panel label', { hasText: 'Depth' }).locator('select').selectOption(value);
  await page.keyboard.press('Escape');
}
