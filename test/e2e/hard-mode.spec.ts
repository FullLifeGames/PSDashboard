import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { test, expect, type Page } from '@playwright/test';
import type { ReplayData } from '@fulllifegames/replay-core';
import { installReplayEmbedCache, routeOfflineFixtures } from './helpers';
import { variationPanel } from './dock-helpers';

/**
 * Round 89 (#153): Hard mode. A click on the engine's top move of player 1 plays the turn out in a variation; the opponent answers with
 * the reply that hurts that move most when the setting is on (the lowest cell of the clicked row in the card's matrix: a matrix pass
 * counts every cell), and with its best row when it is off. One test per game type; each plays both arms on the same turn: singles
 * (Gen 6 OU 655336), VGC (Scarlet/Violet) and Champions OU. The variation's history row names the choices the executed turn held.
 */
const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(here, '../../packages/eval-engine/test/fixtures', `${name}.json`), 'utf-8')) as ReplayData;

test.beforeAll(installReplayEmbedCache);

const GAMES = [
  { kind: 'singles (Gen 6 OU)', id: 'smogtours-gen6ou-655336', turns: [8, 12, 5] },
  { kind: 'VGC (Scarlet/Violet)', id: 'gen9vgc2026regi-2630452654', turns: [4, 6, 3] },
  { kind: 'Champions OU', id: 'gen9championsou-2691703002', turns: [8, 12, 5] },
];

/** The words the history row prints for one ranked label: a doubles label holds a part per slot ("Fake Out → Rillaboom + Spore → Tornadus"). */
const partsOf = (label: string): string[] => label.split(' + ').map(part => part.replace(/ → .+$/, '').trim()).filter(part => part !== '');

async function openPage(page: Page, replay: ReplayData, hardMode: boolean): Promise<void> {
  await routeOfflineFixtures(page);
  await page.addInitScript(on => {
    localStorage.setItem('ps-replay-interceptor:eval-pool', '2');
    localStorage.setItem('ps-replay-interceptor:eval-prefs', JSON.stringify({ depth: 1, samples: 1, auto: false, tera: 'auto', ...(on ? { hardMode: true } : {}) }));
  }, hardMode);
  await page.goto('/');
  // registered last, so it answers before routeOfflineFixtures' default replay
  await page.route('**/replay.pokemonshowdown.com/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(replay) }));
  await page.locator('input[type="text"]').first().fill(replay.id);
  await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
  await expect(page.getByText(replay.players[0], { exact: true }).first()).toBeVisible({ timeout: 30_000 });
}

/** What the evaluated turn offers: the clicked row, the opponent's best row and the matrix's reading of the row. */
interface Offer { own: string; best: string; hurtMost: string[] }

async function evaluateTurn(page: Page, turn: number): Promise<Offer> {
  const panel = page.locator('.ps-main-right .ps-eval-panel');
  await page.locator('input[type="range"]').fill(String(turn));
  await panel.getByRole('button', { name: /^(Evaluate|Re-evaluate)$/ }).click();
  await expect(panel.locator('.ps-eval-bar')).toBeVisible({ timeout: 300_000 });
  const label = async (column: number): Promise<string> =>
    ((await panel.locator('.ps-eval-column').nth(column).locator('.ps-eval-choice-main > span').nth(1).textContent()) ?? '').trim();
  const own = await label(0);
  const best = await label(1);
  await panel.getByRole('button', { name: 'Matrix', exact: true }).click();
  // a cell's title reads "<own row> × <reply>: <player 1> NN% · <player 2> MM%"
  const titles = await panel.locator('td[title], td button[title]').evaluateAll(cells => cells.map(cell => cell.getAttribute('title') ?? ''));
  const cells = titles.flatMap(title => {
    const match = /^(.*?) × (.*?): .*? (\d+)% · /.exec(title);
    return match && match[1] === own ? [{ reply: match[2], pct: Number(match[3]) }] : [];
  });
  const lowest = Math.min(...cells.map(cell => cell.pct));
  return { own, best, hurtMost: cells.filter(cell => cell.pct === lowest).map(cell => cell.reply) };
}

async function clickEngineMove(page: Page, turn: number): Promise<string> {
  const panel = page.locator('.ps-main-right .ps-eval-panel');
  await panel.locator('.ps-eval-column').first().locator('button.ps-eval-choice').first().click();
  await expect(page.getByText(/Branching · Turn/)).toBeVisible({ timeout: 120_000 });
  const history = variationPanel(page);
  await expect(history).toContainText(`Turn ${turn}`, { timeout: 120_000 });
  return (await history.textContent()) ?? '';
}

for (const game of GAMES) {
  test(`${game.kind}: the opponent answers an engine click with the reply that hurts most (on) or its best row (off)`, async ({ browser }) => {
    test.setTimeout(900_000);
    const replay = fixture(game.id);
    const context = await browser.newContext();
    try {
      // arm one: Hard mode on, on the first turn whose worst reply is not the opponent's best row (the last candidate otherwise)
      const on = await context.newPage();
      await openPage(on, replay, true);
      await expect(on.getByRole('checkbox', { name: 'Hard mode' })).toBeChecked();
      let turn = game.turns[0];
      let offer = await evaluateTurn(on, turn);
      for (const candidate of game.turns.slice(1)) {
        if (!offer.hurtMost.includes(offer.best)) break;
        turn = candidate;
        offer = await evaluateTurn(on, turn);
      }
      expect(offer.hurtMost.length, 'the matrix names a reply that hurts the clicked move most').toBeGreaterThan(0);
      const worstParts = offer.hurtMost.map(partsOf);
      const hardText = await clickEngineMove(on, turn);
      // the opponent's choice in the executed turn is one of the lowest cells of the row (a tie is the engine's pick of equals)
      expect(worstParts.some(parts => parts.every(part => hardText.includes(part))), `the history names the reply that hurts most (${offer.hurtMost.join(' | ')})`).toBe(true);
      const bestOnly = partsOf(offer.best).filter(part => !worstParts.some(parts => parts.includes(part)) && !partsOf(offer.own).includes(part));
      for (const part of bestOnly) expect(hardText, `the best row's ${part} is not played`).not.toContain(part);

      // arm two: the same turn with the setting off: the opponent's best row
      const off = await context.newPage();
      await openPage(off, replay, false);
      await expect(off.getByRole('checkbox', { name: 'Hard mode' })).not.toBeChecked();
      const second = await evaluateTurn(off, turn);
      expect(second.own).toBe(offer.own);
      const offText = await clickEngineMove(off, turn);
      for (const part of partsOf(second.best)) expect(offText, `the best row's ${part} is played`).toContain(part);
    } finally {
      await context.close();
    }
  });
}
