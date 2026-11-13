import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'fs';
import {
  dockChip, dockReplays, fixturePath, installReplayEmbedCache, moveTimeline, openTray, pickMove, routeOfflineFixtures, type DockSlotKey, dockTray,
} from './helpers';
import { lightEngine, loadDockReplay, openVariationHistory, variationPanel } from './dock-helpers';

test.beforeAll(installReplayEmbedCache);

// Round 88 (T314, #55): a bench offers only bodies the side could have brought. The replay of GitHub issue #4
// (gen9vgc2025regg-2335527677, a bring-four game): P1 fielded Clefable, Dusclops, Ursaluna and Gastrodon, so its bench holds no
// Torracat and no Tsareena (the report: "allowed me to send in torracat as 5th mon"). P2 fielded three bodies (Overqwil,
// Archaludon, Pelipper), so its fourth is unknown: since round 89 (#124) the rebuild plays the heaviest world of that guess, so P2's
// bench holds its fielded bodies and the guess (a body of its team preview), never the whole six. The filter reads the same on the
// replay's own turns (a stored position), on the What-if's turns (a stored position of the variation, the live tip) and at a
// forced replacement.
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
  await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).first().click();
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

/** P1's bench never names a body that stayed home; P2's bench holds its guess, a body of its preview (its fourth body is unknown). */
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
  expect(p2, `${label} p2a offers its guess`).toMatch(P2_HOME);
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

// Round 89 (#124): Champions VGC 2625939941, doubles. P1 fielded Farigiraf, Basculegion and Lopunny and never its fourth body (Ceruledge,
// Ninetales-Alola or Kingambit); P2 brought Aerodactyl, Kingambit, Farigiraf and Sylveon and left Kangaskhan and Torkoal home. Before
// the issue the engine kept six bodies per side and could rank a switch to Kangaskhan; now the rebuild trims both sides to four, P1's
// fourth is the heaviest world's guess, and the other worlds blend into the values. Singles (Battle Stadium Singles) have no e2e
// fixture: the same code is read by the unit rows of the worlds (replay-context-worlds, bench-sweep).
const CHAMPIONS_SHORT = 'gen9championsvgc2026regma-2625939941';
const P2_HOME_BODIES = /Kangaskhan|Torkoal/;
const P1_FIELDED = /Farigiraf|Basculegion|Lopunny/;
const P1_CANDIDATES = /Ceruledge|Ninetales|Kingambit/;

test.describe('Champions VGC, P1 short by one body (2625939941)', () => {
  test.use({ viewport: { width: 1366, height: 768 } });

  test.beforeEach(async ({ page }) => {
    await lightEngine(page);
    await routeOfflineFixtures(page);
    await page.goto('/');
    await loadDockReplay(page, CHAMPIONS_SHORT, 1);
  });

  test('P1\'s fourth tile carries the guess mark and the engine panel ranks no body P2 left home', async ({ page }) => {
    test.setTimeout(600_000);
    expect(dockReplays.some(replay => replay.id === CHAMPIONS_SHORT)).toBe(true);
    // The bench of P1: its other fielded body and the guess, which wears the mark and names where it comes from.
    const tray = await openTray(page, 'p1a');
    const tiles = tray.locator('.ps-switchbtn');
    await tiles.first().waitFor({ timeout: 10_000 });
    const names = (await tiles.locator('.ps-switchbtn-name').allInnerTexts()).map(name => name.trim());
    log(`p1a bench: ${names.join(' | ')}`);
    expect(names.length).toBe(2);
    const marked = tray.locator('.ps-switchbtn', { has: page.locator('.ps-guess-badge') });
    await expect(marked).toHaveCount(1);
    await expect(marked).toContainText(P1_CANDIDATES);
    await expect(marked.locator('.ps-guess-badge')).toHaveAttribute('title', /The log never showed this player's last Pokémon\. The engine plays/);
    await expect(tray.locator('.ps-switchbtn', { hasText: P1_FIELDED }).locator('.ps-guess-badge')).toHaveCount(0);
    // P2 fielded four, so its bench is the four brought bodies and wears no mark.
    const p2 = (await (await openTray(page, 'p2a')).locator('.ps-switchbtn').allInnerTexts()).join(' | ');
    expect(p2).not.toMatch(P2_HOME_BODIES);
    await expect(dockTray(page).locator('.ps-guess-badge')).toHaveCount(0);

    // The panel ranks choices of the worlds' blend: the rows name no unbrought body of P2.
    const panel = page.locator('.ps-main-right .ps-eval-panel');
    await panel.locator('button', { hasText: 'Analyze game' }).click();
    await expect(panel.locator('button', { hasText: 'Re-analyze' })).toBeVisible({ timeout: 360_000 });
    await panel.locator('.ps-eval-graph rect[data-turn="1"]').click();
    await expect(panel.locator('.ps-eval-choice').first()).toBeVisible({ timeout: 120_000 });
    const rows = (await panel.locator('.ps-eval-choice').allInnerTexts()).join('\n');
    log(`ranked rows: ${rows.replace(/\s+/g, ' ').slice(0, 400)}`);
    expect(rows).not.toMatch(P2_HOME_BODIES);
  });

  test('Let it play out from turn 1 fields no body P2 left home', async ({ page }) => {
    test.setTimeout(420_000);
    await page.locator('button', { hasText: 'Let it play out' }).click();
    await expect(page.getByText(/Engine is playing both sides from turn 1/)).toBeVisible({ timeout: 120_000 });
    await expect.poll(async () => {
      const body = await page.textContent('body');
      return /Engine is playing both sides from turn 1\. [1-9]/.test(body ?? '') || /after [1-9]\d* turns?/.test(body ?? '');
    }, { timeout: 300_000 }).toBe(true);
    await page.locator('.ps-btn', { hasText: 'Stop' }).click();
    await expect(page.getByText(/Play-out stopped|Play-out finished/)).toBeVisible({ timeout: 60_000 });
    await openVariationHistory(page);
    const history = await variationPanel(page).innerText();
    log(`history: ${history.replace(/\s+/g, ' ').slice(0, 400)}`);
    expect(history).not.toMatch(P2_HOME_BODIES);
  });
});
