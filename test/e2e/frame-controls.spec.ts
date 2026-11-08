import { test, expect, type Frame, type Page } from '@playwright/test';
import {
  fixtureReplay, installReplayEmbedCache, moveTimeline, routeOfflineFixtures, startVariationAt, waitForExactPickers, type ReplayWindow,
} from './helpers';
import { lightEngine, loadDockReplay } from './dock-helpers';

/**
 * Round 88 (T316, #56): the workspace's replay frames hide the two choosers that do nothing in the app (Color scheme, Music). Play,
 * Last turn, Next turn, Go to turn..., Reset, Speed and Switch sides stay and work (the gate of 08.11.2026 brought the three turn
 * buttons back, which T316 had hidden), and the
 * dock's top row belongs to the side the frame shows near: at load (P1, P2 with ?p2), after Switch sides and after a rebuild of the
 * frame. Singles and doubles. State is read from the frame's own battle (`Replays.battle`), never from a click count.
 */
const DOUBLES = 'gen9doublesou-2693620934';
/** The turn each fixture is loaded at: singles at turn 2 (the fixture has four), doubles at turn 5. */
const SINGLES_TURN = 2;
const DOUBLES_TURN = 5;

test.beforeAll(installReplayEmbedCache);
test.beforeEach(async ({ page }) => {
  await lightEngine(page);
  await routeOfflineFixtures(page);
  await page.goto('/');
});

/** The document of the frame on show (the main frame, or the branch frame once a variation has a turn of its own). */
async function frameOf(page: Page, title: 'PS Replay' | 'Branch Simulation' = 'PS Replay'): Promise<Frame> {
  const handle = await page.locator(`iframe[title="${title}"]`).elementHandle({ timeout: 30_000 });
  const frame = await handle!.contentFrame();
  await expect.poll(() => frame!.evaluate(() => !!(window as ReplayWindow).Replays?.battle), { timeout: 60_000 }).toBe(true);
  return frame!;
}

/** The `data-action` (or `value`) of every visible button of one control row, in order. */
const visibleActions = (frame: Frame, row: string) => frame.evaluate(selector => [...document.querySelectorAll(`${selector} button`)]
  .filter(button => getComputedStyle(button).display !== 'none' && button.getBoundingClientRect().width > 0)
  .map(button => button.getAttribute('data-action') ?? button.getAttribute('value')), row);

const nearSide = (frame: Frame) => frame.evaluate(() => (window as ReplayWindow).Replays?.battle?.nearSide?.sideid ?? null);
const switchSides = (frame: Frame) => frame.locator('.replay-controls button[data-action="switchViewpoint"]').click();

/** The sides of the dock's first row: `data-chip` is the side and the slot index (p10 is P1's first slot, p20 P2's). */
const firstRowSides = (page: Page) => page.locator('.ps-dock-row').first().locator('.ps-dock-chip')
  .evaluateAll(chips => chips.map(chip => (chip.getAttribute('data-chip') ?? '').slice(0, 2)));

/**
 * The sides of the dock's first row with `near` on top: singles hold both chips in one row (the near side's first), doubles and VGC
 * hold the near side's two chips.
 */
const nearRow = (near: 'p1' | 'p2', slots: number) => {
  if (slots > 1) return [near, near];
  return near === 'p1' ? ['p1', 'p2'] : ['p2', 'p1'];
};

async function loadSingles(page: Page) {
  await page.locator('button', { hasText: 'Load' }).click();
  await expect(page.locator('iframe[title="PS Replay"]')).toBeVisible({ timeout: 10_000 });
}

async function expectFrameControls(frame: Frame) {
  // One button plays and pauses (the live branch frame plays at once, so it reads pause): both stand for the first control.
  const row1 = async () => (await visibleActions(frame, '.replay-controls')).map(action => (action === 'pause' ? 'play' : action));
  await expect.poll(row1).toEqual(['play', 'reset', 'rewind', 'ff', 'ffto', 'switchViewpoint']);
  await expect(frame.locator('.replay-controls-2 .speedchooser')).toBeVisible();
  await expect(frame.locator('.replay-controls-2 .colorchooser')).toBeHidden();
  await expect(frame.locator('.replay-controls-2 .soundchooser')).toBeHidden();
  expect(await visibleActions(frame, '.replay-controls-2 .speedchooser')).toEqual(['hyperfast', 'fast', 'normal', 'slow', 'reallyslow']);
  // Music stays off with its chooser gone: the embed's own flag and the stubbed BattleSound both read muted.
  await expect.poll(() => frame.evaluate(() => (window as ReplayWindow).Replays?.muted === true && (window as ReplayWindow).BattleSound?.muted === true)).toBe(true);
}

test.describe('the frame keeps Play, the turn buttons, Reset, Speed and Switch sides', () => {
  test('singles, main frame: Last turn, Next turn and Go to turn... shown; no Color scheme or Music; music off at load', async ({ page }) => {
    test.setTimeout(120_000);
    await loadSingles(page);
    await expectFrameControls(await frameOf(page));
  });

  test('singles, branch frame: the same controls', async ({ page }) => {
    test.setTimeout(240_000);
    await loadSingles(page);
    await startVariationAt(page, 2);
    await expectFrameControls(await frameOf(page, 'Branch Simulation'));
  });

  test('the kept controls work: Hyperfast, Play, Pause, Next turn, Last turn, Switch sides, Reset', async ({ page }) => {
    test.setTimeout(180_000);
    await loadSingles(page);
    await moveTimeline(page, 1);
    const frame = await frameOf(page);
    const battle = () => frame.evaluate(() => {
      const state = (window as ReplayWindow).Replays?.battle;
      return { paused: state?.paused, turn: state?.turn ?? -1, fade: state?.messageFadeTime };
    });
    const slider = page.locator('.ps-branch-bar input[type="range"]');

    await frame.locator('.speedchooser button[value="hyperfast"]').click();
    await expect(frame.locator('.speedchooser button.sel')).toHaveText('Hyperfast');
    await expect.poll(async () => (await battle()).fade).toBe(40);

    await frame.locator('.replay-controls button[data-action="play"]').click();
    await expect.poll(async () => (await battle()).paused).toBe(false);
    await expect.poll(async () => (await battle()).turn, { timeout: 60_000 }).toBeGreaterThanOrEqual(2);
    await expect.poll(async () => Number(await slider.inputValue())).toBeGreaterThanOrEqual(2);

    await frame.locator('.replay-controls button[data-action="pause"]').click();
    await expect.poll(async () => (await battle()).paused).toBe(true);

    // Next turn and Last turn move the frame one turn, and the timeline follows the frame's report
    const paused = (await battle()).turn;
    await frame.locator('.replay-controls button[data-action="rewind"]').click();
    await expect.poll(async () => (await battle()).turn).toBe(paused - 1);
    await expect.poll(async () => Number(await slider.inputValue())).toBe(paused - 1);
    await frame.locator('.replay-controls button[data-action="ff"]').click();
    await expect.poll(async () => (await battle()).turn).toBe(paused);
    await expect.poll(async () => Number(await slider.inputValue())).toBe(paused);

    await switchSides(frame);
    await expect.poll(() => nearSide(frame)).toBe('p2');

    await frame.locator('.replay-controls button[data-action="reset"]').click();
    await expect.poll(async () => (await battle()).paused).toBe(true);
    await expect.poll(async () => (await battle()).turn).toBeLessThanOrEqual(0);
  });
});

/**
 * Switch sides, then rebuild the frame: a variation with a turn of its own mounts the branch frame (a new document), which starts
 * from P1 and tells so; Switch sides there gives P2; back on the main line the main frame mounts anew and reads P1 again.
 */
async function expectRebuildStartsFromP1(page: Page, mainFrame: Frame, turn: number, slots: number) {
  const home = nearRow('p1', slots);
  const away = nearRow('p2', slots);
  await switchSides(mainFrame);
  await expect.poll(() => firstRowSides(page)).toEqual(away);
  await startVariationAt(page, turn);
  const branch = await frameOf(page, 'Branch Simulation');
  await expect.poll(() => firstRowSides(page)).toEqual(home);
  await expect.poll(() => nearSide(branch)).toBe('p1');
  await switchSides(branch);
  await expect.poll(() => nearSide(branch)).toBe('p2');
  await expect.poll(() => firstRowSides(page)).toEqual(away);
  // The variation starts at `turn`: one turn before it is the main line, and the main frame mounts anew.
  await moveTimeline(page, turn - 1);
  await expect(page.locator('iframe[title="PS Replay"]')).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => firstRowSides(page)).toEqual(home);
}

test.describe('the dock puts the side the frame shows near first', () => {
  test('singles: Switch sides swaps the two chips; a rebuilt frame starts from P1 again', async ({ page }) => {
    test.setTimeout(300_000);
    await loadDockReplay(page, fixtureReplay.id, SINGLES_TURN);
    expect(await firstRowSides(page)).toEqual(nearRow('p1', 1));
    const frame = await frameOf(page);
    await switchSides(frame);
    await expect.poll(() => firstRowSides(page)).toEqual(nearRow('p2', 1));
    await switchSides(frame);
    await expect.poll(() => firstRowSides(page)).toEqual(nearRow('p1', 1));
    await expectRebuildStartsFromP1(page, frame, SINGLES_TURN, 1);
  });

  test('doubles: Switch sides swaps the two rows; a rebuilt frame starts from P1 again', async ({ page }) => {
    test.setTimeout(300_000);
    await loadDockReplay(page, DOUBLES, DOUBLES_TURN);
    expect(await firstRowSides(page)).toEqual(nearRow('p1', 2));
    const frame = await frameOf(page);
    await switchSides(frame);
    await expect.poll(() => firstRowSides(page)).toEqual(nearRow('p2', 2));
    await switchSides(frame);
    await expect.poll(() => firstRowSides(page)).toEqual(nearRow('p1', 2));
    await expectRebuildStartsFromP1(page, frame, DOUBLES_TURN, 2);
  });
});

test.describe('a replay opened from the second player\'s side (?p2)', () => {
  const cases = [
    { kind: 'singles', id: fixtureReplay.id, turn: SINGLES_TURN, slots: 1 },
    { kind: 'doubles', id: DOUBLES, turn: DOUBLES_TURN, slots: 2 },
  ];
  for (const { kind, id, turn, slots } of cases) {
    test(`${kind}: the frame's near side is p2 and the first row holds P2 at load, never P1 first; Switch sides gives P1`, async ({ page }) => {
      test.setTimeout(240_000);
      // Every 50 ms from the start of the page: the first chip of the dock, so a flip at load shows in the samples.
      await page.addInitScript(() => {
        const samples: string[] = [];
        (window as unknown as { __firstChips: string[] }).__firstChips = samples;
        setInterval(() => {
          const chip = document.querySelector('.ps-dock-row .ps-dock-chip');
          if (chip) samples.push(chip.getAttribute('data-chip') ?? '');
        }, 50);
      });
      await page.goto('/');
      await page.locator('input[type="text"]').fill(`https://replay.pokemonshowdown.com/${id}?p2`);
      await page.locator('button', { hasText: 'Load' }).click();
      await waitForExactPickers(page, turn);
      const frame = await frameOf(page);
      await expect.poll(() => nearSide(frame)).toBe('p2');
      await expect.poll(() => firstRowSides(page)).toEqual(nearRow('p2', slots));
      const samples = await page.evaluate(() => (window as unknown as { __firstChips: string[] }).__firstChips);
      expect(samples.length, 'the sampler saw the dock').toBeGreaterThan(0);
      expect(samples.filter(chip => !chip.startsWith('p2')), `first chips seen from load on: ${JSON.stringify(samples.slice(0, 20))}`).toEqual([]);
      await switchSides(frame);
      await expect.poll(() => nearSide(frame)).toBe('p1');
      await expect.poll(() => firstRowSides(page)).toEqual(nearRow('p1', slots));
    });
  }
});
