import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'fs';
import {
  dockChip, fixturePath, installReplayEmbedCache, moveTimeline, openTray, pickMove, routeOfflineFixtures, type DockSlotKey,
} from './helpers';

test.beforeAll(installReplayEmbedCache);

// Round 88 (T314, #55): a bench offers only bodies the side could have brought. The replay of GitHub issue #4
// (gen9vgc2025regg-2335527677, a bring-four game): P1 fielded Clefable, Dusclops, Ursaluna and Gastrodon, so its bench holds no
// Torracat and no Tsareena (the report: "allowed me to send in torracat as 5th mon"). P2 fielded three bodies (Overqwil,
// Archaludon, Pelipper), so its fourth is unknown and its bench stays whole. The rebuild keeps six bodies per side for the
// evaluation (a pinned four against an open six flips games), so the filter reads the same on the replay's own turns (a stored
// position), on the What-if's turns (a stored position of the variation, the live tip) and at a forced replacement.
const FILE = 'interlude-vgc-2335527677.json';
const P1_BROUGHT = /Clefable|Dusclops|Ursaluna|Gastrodon/;
const P1_HOME = /Torracat|Tsareena/;
const P2_HOME = /Decidueye|Donphan|Grumpig/;

async function load(page: Page) {
  const replay = JSON.parse(readFileSync(fixturePath(FILE), 'utf-8')) as { id: string };
  await routeOfflineFixtures(page);
  await page.route('**/replay.pokemonshowdown.com/**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: readFileSync(fixturePath(FILE), 'utf-8'),
  }));
  await page.goto('/');
  await page.locator('input[type="text"]').first().fill(replay.id);
  await page.locator('button', { hasText: 'Load' }).first().click();
  await expect(page.locator('.ps-branch-bar input[type="range"]')).toBeVisible({ timeout: 60_000 });
}

const stamp = Date.now();
const log = (text: string) => console.log(`[bench-bring +${Math.round((Date.now() - stamp) / 1000)}s] ${text}`);

/** The bodies one slot's tray offers as a switch (none when the slot's tray offers no switch: a position that waits on the other side). */
async function bench(page: Page, slot: DockSlotKey): Promise<string[]> {
  const tray = await openTray(page, slot);
  await tray.locator('.ps-switchbtn').first().waitFor({ timeout: 8_000 }).catch(() => undefined);
  return (await tray.locator('.ps-switchbtn').allInnerTexts()).map(text => text.replace(/\s+/g, ' ').trim());
}

/** P1's bench never names a body that stayed home; P2's whole bench stays (its fourth body is unknown). */
async function expectBenches(page: Page, label: string, { expectP1 = true } = {}) {
  for (const slot of ['p1a', 'p1b'] as const) {
    const offered = await bench(page, slot);
    log(`${label} ${slot}: ${offered.join(' | ')}`);
    if (expectP1) expect(offered.length, `${label} ${slot}`).toBeGreaterThan(0);
    for (const text of offered) {
      expect(text, `${label} ${slot} offers ${text}`).toMatch(P1_BROUGHT);
      expect(text, `${label} ${slot} offers ${text}`).not.toMatch(P1_HOME);
    }
  }
  const p2 = (await bench(page, 'p2a')).join(' | ');
  log(`${label} p2a: ${p2}`);
  expect(p2, `${label} p2a keeps its whole bench`).toMatch(P2_HOME);
}

/** A forced replacement of the variation: the bench it offers is the filtered one; the first body takes the slot. */
async function settleForced(page: Page, label: string) {
  for (let round = 0; round < 6; round++) {
    const forced = page.locator('.ps-dock-chip[data-forced="true"]');
    await forced.first().waitFor({ timeout: 4_000 }).catch(() => undefined);
    if (await forced.count() === 0) return;
    // The chip names its slot as "p10" (side 1, slot 0): the helpers' keys are "p1a".
    const raw = (await forced.first().getAttribute('data-chip')) ?? '';
    const slot = `${raw.slice(0, 2)}${raw[2] === '0' ? 'a' : 'b'}` as DockSlotKey;
    const offered = await bench(page, slot);
    log(`${label} forced ${slot}: ${offered.join(' | ')}`);
    if (slot.startsWith('p1')) for (const text of offered) expect(text, `${label} forced ${slot} offers ${text}`).not.toMatch(P1_HOME);
    await (await openTray(page, slot)).locator('.ps-switchbtn:enabled').first().click();
    await page.waitForTimeout(1_000);
  }
}

async function playTurn(page: Page, label: string) {
  for (const slot of ['p1a', 'p1b', 'p2a', 'p2b'] as const) await pickMove(page, slot);
  log(`${label}: moves picked`);
  await page.locator('.ps-execute-btn').click();
  await expect(page.locator('.ps-execute-btn:not([disabled])')).toBeVisible({ timeout: 60_000 });
  log(`${label}: executed`);
  await settleForced(page, label);
}

async function startAtTurnOne(page: Page) {
  await load(page);
  await moveTimeline(page, 1);
  await expect(page.locator('.ps-dock-status')).toContainText('Choices from the reconstructed position', { timeout: 120_000 });
  log('loaded');
}

test('doubles, bring four: the replay turn offers no body that stayed home', async ({ page }) => {
  test.setTimeout(240_000);
  await startAtTurnOne(page);
  await expectBenches(page, 'replay T1');
  await expect(dockChip(page, 'p1a')).toBeVisible();
});

test('doubles, bring four: the What-if tip, its inner turn and its forced replacement offer no body that stayed home', async ({ page }) => {
  test.setTimeout(420_000);
  await startAtTurnOne(page);
  // The What-if from turn 1: two turns by hand, so the variation holds an inner turn and a live tip.
  await playTurn(page, 'variation turn 1');
  await playTurn(page, 'variation turn 2');
  await expectBenches(page, 'variation tip', { expectP1: false });
  await moveTimeline(page, 2);
  await expect(page.getByText('T2/')).toBeVisible();
  await expect(page.locator('.ps-dock-chip').first()).toBeVisible({ timeout: 30_000 });
  await expectBenches(page, 'variation inner turn');
});
