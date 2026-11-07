import { test, expect, type Frame, type Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { fixturePath, installReplayEmbedCache, routeOfflineFixtures, startVariationAt, type ReplayWindow } from './helpers';

test.beforeAll(installReplayEmbedCache);

// Round 88 (T347, #83): the end of a play-out leaves the replay where the user watches it. Singles and doubles both run
// (Fast play-out: the singles replay hits the 100-turn cap in about 30 seconds, the doubles replay ends its battle after a
// dozen turns). The branch frame is read through Replays.battle, the slider through the bar's "T<turn>/<max>" label.
const REPLAYS = [
  ['singles', 'replay.json'],
  ['doubles', 'dock-doublesou-2693620934.json'],
] as const;

const notice = (page: Page) => page.getByText(/Play-out (finished|stopped)/);
const branchIframe = (page: Page) => page.locator('iframe[title="Branch Simulation"]');

async function load(page: Page, file: string) {
  const replay = JSON.parse(readFileSync(fixturePath(file), 'utf-8')) as { id: string };
  await routeOfflineFixtures(page);
  await page.goto('/');
  await page.locator('input[type="text"]').first().fill(replay.id);
  await page.locator('button', { hasText: 'Load' }).first().click();
  await expect(page.locator('.ps-branch-bar input[type="range"]')).toBeVisible({ timeout: 60_000 });
}

async function branchFrame(page: Page): Promise<Frame> {
  const handle = await branchIframe(page).elementHandle({ timeout: 120_000 });
  const frame = (await handle!.contentFrame())!;
  await expect.poll(() => frame.evaluate(() => !!(window as ReplayWindow).Replays?.battle), { timeout: 30_000 }).toBe(true);
  return frame;
}

async function frameState(frame: Frame) {
  return frame.evaluate(() => {
    const battle = (window as ReplayWindow).Replays?.battle;
    return { turn: battle?.turn ?? -1, paused: !!battle?.paused, atQueueEnd: !!battle?.atQueueEnd };
  });
}

/** The turn the slider names ("T7/100"). */
async function sliderTurn(page: Page): Promise<number> {
  const label = await page.locator('.ps-branch-bar').innerText();
  return Number(/T(\d+)\/\d+/.exec(label)?.[1] ?? -1);
}

/** Press Play in the frame when it stands, then its fastest speed (the engine's line plays to the end during the run). */
async function playHyperfast(frame: Frame) {
  const paused = await frame.evaluate(() => !!(window as ReplayWindow).Replays?.battle?.paused);
  if (paused) await frame.locator('button').filter({ hasText: /^\s*Play\s*$/ }).first().click({ timeout: 10_000 });
  await frame.locator('button').filter({ hasText: /^\s*Hyperfast\s*$/ }).first().click({ timeout: 10_000 });
}

async function playOutFromVariation(page: Page, file: string) {
  await load(page, file);
  await startVariationAt(page, 2);
  const frame = await branchFrame(page);
  await expect(page.locator('.ps-dock-chip').first()).toBeVisible({ timeout: 60_000 });
  await page.getByLabel('Fast play-out').check();
  return frame;
}

test.describe('the end of a play-out', () => {
  for (const [name, file] of REPLAYS) {
    test(`${name}: a frame that plays during the run keeps playing from its turn after the notice`, async ({ page }) => {
      test.setTimeout(240_000);
      const frame = await playOutFromVariation(page, file);
      await page.locator('button', { hasText: 'Let it play out' }).click();
      await playHyperfast(frame);
      await expect(notice(page)).toBeVisible({ timeout: 180_000 });

      // The notice leaves the frame where it stands: its turn never drops, it plays on unless it reached the end of its log.
      const atNotice = await frameState(frame);
      for (let sample = 0; sample < 6; sample++) {
        await page.waitForTimeout(500);
        const now = await frameState(frame);
        expect(now.turn, `sample ${sample}, at the notice ${JSON.stringify(atNotice)}`).toBeGreaterThanOrEqual(atNotice.turn);
        expect(now.paused && !now.atQueueEnd, `sample ${sample}: ${JSON.stringify(now)}`).toBe(false);
      }
      // Pointer and frame name the same turn: the end position of an ended battle sits one past the last played turn.
      await expect.poll(async () => {
        const [slider, shown] = [await sliderTurn(page), (await frameState(frame)).turn];
        return slider - shown;
      }, { timeout: 10_000, intervals: [250] }).toBeGreaterThanOrEqual(0);
      expect(await sliderTurn(page)).toBeGreaterThanOrEqual(atNotice.turn);
      await expect(branchIframe(page)).toHaveCount(1);
      await expect(page.locator('.ps-line-chip button.on-vari')).toBeVisible();
    });

    test(`${name}: a run from the main line leaves the branch frame mounted on the turn it showed`, async ({ page }) => {
      test.setTimeout(240_000);
      await load(page, file);
      await page.locator('.ps-branch-bar input[type="range"]').fill('2');
      await expect(page.locator('.ps-dock-chip').first()).toBeVisible({ timeout: 60_000 });
      await page.getByLabel('Fast play-out').check();
      await page.locator('button', { hasText: 'Let it play out' }).click();
      const frame = await branchFrame(page);
      await expect(notice(page)).toBeVisible({ timeout: 180_000 });

      // Before: the run left the variation and swapped the main replay in at the start turn.
      const atNotice = await frameState(frame);
      await page.waitForTimeout(3000);
      await expect(branchIframe(page)).toHaveCount(1);
      await expect(page.locator('.ps-line-chip button.on-vari')).toBeVisible();
      const later = await frameState(frame);
      expect(later.turn, 'the frame stands where the run left it').toBe(atNotice.turn);
      // The frame's start turn holds the shared prefix: the pointer takes the first covered turn, 3 for a run from turn 2.
      expect(await sliderTurn(page)).toBe(Math.max(atNotice.turn, 3));
    });

    test(`${name}: Watch from turn N plays the variation from N while the frame plays past N`, async ({ page }) => {
      test.setTimeout(240_000);
      const frame = await playOutFromVariation(page, file);
      await page.locator('button', { hasText: 'Let it play out' }).click();
      await expect(notice(page)).toBeVisible({ timeout: 180_000 });
      const watch = page.locator('button', { hasText: /Watch from turn \d+/ }).first();
      const watchTurn = Number(/Watch from turn (\d+)/.exec(await watch.innerText())?.[1]);

      // Let the frame play past the start of the run, then press Watch.
      await frame.evaluate(() => { const battle = (window as ReplayWindow).Replays?.battle as { paused?: boolean; play?: () => void } | undefined; if (battle?.paused) battle.play?.(); });
      await expect.poll(async () => (await frameState(frame)).turn, { timeout: 90_000 }).toBeGreaterThanOrEqual(watchTurn + 2);
      await watch.click();
      await expect.poll(async () => (await frameState(frame)).turn, { timeout: 3000, intervals: [100] }).toBeLessThanOrEqual(watchTurn);
      await expect.poll(async () => {
        const state = await frameState(frame);
        return !state.paused || state.atQueueEnd;
      }, { timeout: 10_000 }).toBe(true);
      await expect.poll(async () => (await frameState(frame)).turn, { timeout: 30_000 }).toBeGreaterThan(watchTurn);
      await expect(branchIframe(page)).toHaveCount(1);
      await expect(page.locator('.ps-line-chip button.on-vari')).toBeVisible();
    });

    test(`${name}: a stop with a turn in flight sends the frame no play or follow-end command`, async ({ page }) => {
      test.setTimeout(240_000);
      const frame = await playOutFromVariation(page, file);
      // Every append the frame receives, with the time of the Stop click (20 ms after the progress line counts the third turn).
      await frame.evaluate(() => {
        const w = window as unknown as { __appends: { t: number; playFromTurn?: number; followEnd?: boolean }[] };
        w.__appends = [];
        window.addEventListener('message', event => {
          const data = event.data || {};
          if (data.type === 'ps-append-log') w.__appends.push({ t: Date.now(), playFromTurn: data.playFromTurn, followEnd: data.followEnd });
        });
      });
      await page.evaluate(() => {
        const w = window as unknown as { __stopAt: number | null };
        w.__stopAt = null;
        const observer = new MutationObserver(() => {
          const progress = (document.querySelector('.ps-playout-progress') as HTMLElement | null)?.innerText ?? '';
          const stop = Array.from(document.querySelectorAll('button')).find(button => button.textContent?.trim() === 'Stop');
          if (w.__stopAt === null && /\b3 turns played/.test(progress) && stop) {
            w.__stopAt = 0;
            // A separate task, as a user's click is: the passive effects of the render have run by then.
            setTimeout(() => { w.__stopAt = Date.now(); stop.click(); }, 20);
          }
        });
        observer.observe(document.body, { subtree: true, childList: true, characterData: true });
      });
      await page.locator('button', { hasText: 'Let it play out' }).click();
      await expect(notice(page)).toBeVisible({ timeout: 180_000 });
      const stopAt = await page.evaluate(() => (window as unknown as { __stopAt: number | null }).__stopAt);
      expect(stopAt, 'the run reached three turns').toBeGreaterThan(0);

      const appends = await frame.evaluate(() => (window as unknown as { __appends: { t: number; playFromTurn?: number; followEnd?: boolean }[] }).__appends);
      const late = appends.filter(append => append.t >= (stopAt ?? 0));
      // Only a turn that landed after the stop can break the rule; the unit rows of usePlayOut.spec.tsx carry it for the run
      // where none landed.
      for (const append of late) {
        expect(append.playFromTurn, JSON.stringify(append)).toBeUndefined();
        expect(append.followEnd, JSON.stringify(append)).not.toBe(true);
      }
    });
  }
});
