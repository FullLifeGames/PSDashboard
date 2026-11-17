import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { test, expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import type { ReplayData } from '@fulllifegames/replay-core';
import { installReplayEmbedCache, routeOfflineFixtures } from './helpers';
import { variationPanel } from './dock-helpers';

/**
 * Round 89 (#153): Hard mode. A click on the engine's top move of player 1 plays the turn out in a variation; the opponent answers with
 * the reply that hurts that move most when the setting is on (the lowest cell of the clicked row in the card's matrix: a matrix pass
 * counts every cell), and with its best row when it is off. One test per game type; each plays both arms on the same turn: singles
 * (Gen 6 OU 655336), Doubles OU, VGC (Scarlet/Violet) and Champions OU. The variation's history row names the choices the executed turn held.
 */
const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(here, '../../packages/eval-engine/test/fixtures', `${name}.json`), 'utf-8')) as ReplayData;

test.beforeAll(installReplayEmbedCache);

const GAMES = [
  { kind: 'singles (Gen 6 OU)', id: 'smogtours-gen6ou-655336', turns: [8, 12, 5] },
  { kind: 'Doubles OU', id: 'smogtours-gen9doublesou-912884', turns: [5, 8, 11] },
  { kind: 'VGC (Scarlet/Violet)', id: 'gen9vgc2026regi-2630452654', turns: [4, 6, 3] },
  { kind: 'Champions OU', id: 'gen9championsou-2691703002', turns: [8, 12, 5] },
];

/**
 * The words the history row prints for one ranked label. A doubles label holds a part per slot ("Fake Out→Rillaboom + Spore→Tornadus")
 * and the history names the move and the target's position instead of its target's species, so a move part keeps the move. A switch
 * part ("→ Calyrex-Ice") names the species, while the history prints the Pokémon's name as the game's log gave it ("→ Calyrex"):
 * `names` maps a species to that name. A gimmick part ("Tera + Encore→X") is printed as "(Tera)" beside the move.
 */
type Names = ReadonlyMap<string, string>;

/** The name each species goes by in the replay's log (`|switch|p2b: Calyrex|Calyrex-Ice, L50|…`). */
const namesOf = (replay: ReplayData): Names => {
  const names = new Map<string, string>();
  for (const line of String(replay.log).split('\n')) {
    const match = /^\|(?:switch|drag|replace)\|p\d[a-c]?: ([^|]+)\|([^,|]+)/.exec(line);
    if (match && !names.has(match[2])) names.set(match[2], match[1]);
  }
  return names;
};

const GIMMICKS = new Set(['Tera', 'Mega', 'Ultra']);

const partsOf = (label: string, names: Names): string[] => label.split(' + ')
  .map(part => part.trim())
  .map(part => {
    if (GIMMICKS.has(part)) return `(${part})`;
    if (part.startsWith('→')) {
      const species = part.slice(1).trim();
      return `→ ${names.get(species) ?? species}`;
    }
    return part.replace(/\s*→.*$/, '').replace(/\s*\(.*\)$/, '').trim();
  })
  .filter(part => part !== '');

async function openPage(page: Page, replay: ReplayData, hardMode: boolean): Promise<void> {
  // a click or a read that misses fails in seconds, not at the test's limit
  page.setDefaultTimeout(30_000);
  await routeOfflineFixtures(page);
  await page.addInitScript(on => {
    localStorage.setItem('ps-replay-interceptor:eval-pool', '2');
    localStorage.setItem('ps-replay-interceptor:eval-prefs', JSON.stringify({ depth: 1, samples: 1, mode: 'matrix', auto: false, tera: 'auto', ...(on ? { hardMode: true } : {}) }));
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

/**
 * The panel lands on the game report when the first report of a game appears, which can happen right after a turn's search finishes:
 * the turn's view then closes. A click on the turn's column of the graph opens it again; the loop accepts the view when it stays.
 */
async function settleOnTurn(page: Page, panel: Locator, turn: number): Promise<void> {
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    const column = panel.locator(`svg rect[data-turn="${turn}"]`).first();
    if (await column.count() > 0) await column.click({ force: true, timeout: 5000 }).catch(() => {});
    if (await panel.locator('.ps-eval-bar').first().isVisible()) {
      await page.waitForTimeout(1500);
      if (await panel.locator('.ps-eval-bar').first().isVisible()) return;
    }
    await page.waitForTimeout(2000);
  }
  throw new Error(`the card of turn ${turn} did not open within 150 s`);
}

async function evaluateTurn(page: Page, turn: number): Promise<Offer> {
  const panel = page.locator('.ps-main-right .ps-eval-panel');
  await page.locator('input[type="range"]').fill(String(turn));
  // the replay view of a main-line turn searches through "Analyze this position"; the card, ranked rows and matrix follow
  const analyze = panel.getByRole('button', { name: /^Analyze this position/ });
  await expect(analyze).toBeEnabled({ timeout: 60_000 });
  await analyze.click();
  await settleOnTurn(page, panel, turn);
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
  expect(cells.length, `the matrix holds cells of the row ${own} (${titles.length} titles)`).toBeGreaterThan(0);
  const lowest = Math.min(...cells.map(cell => cell.pct));
  return { own, best, hurtMost: cells.filter(cell => cell.pct === lowest).map(cell => cell.reply) };
}

async function clickEngineMove(page: Page, turn: number): Promise<string> {
  const panel = page.locator('.ps-main-right .ps-eval-panel');
  await panel.locator('.ps-eval-column').first().locator('button.ps-eval-choice').first().click();
  await expect(page.getByText(/Variation tip: Turn/)).toBeVisible({ timeout: 90_000 });
  const history = variationPanel(page);
  await expect(history).toContainText(`Turn ${turn}`, { timeout: 90_000 });
  return (await history.textContent()) ?? '';
}

/** Both arms on one turn: Hard mode on reads the matrix and the history, Hard mode off the opponent's best row. */
async function runGame(contexts: BrowserContext[], browser: Browser, replay: ReplayData, turns: number[]): Promise<void> {
  const names = namesOf(replay);
  const partsIn = (label: string): string[] => partsOf(label, names);
  // arm one: Hard mode on, on the first turn whose worst reply is not the opponent's best row (the last candidate otherwise)
  // each arm gets its own browser context: the preferences live in localStorage, which pages of one context share, and a page that
  // persists them after the other page's init script ran would hand its setting over (CI run 43662351755: the "off" page read the
  // "on" page's Hard mode). Two tabs of one user do share the stored value in the app; each keeps its own until the next load.
  const onContext = await browser.newContext();
  contexts.push(onContext);
  const on = await onContext.newPage();
  await openPage(on, replay, true);
  await expect(on.getByRole('checkbox', { name: 'Hard mode' })).toBeChecked();
  let turn = turns[0];
  let offer = await evaluateTurn(on, turn);
  for (const candidate of turns.slice(1)) {
    if (!offer.hurtMost.includes(offer.best)) break;
    turn = candidate;
    offer = await evaluateTurn(on, turn);
  }
  expect(offer.hurtMost.length, 'the matrix names a reply that hurts the clicked move most').toBeGreaterThan(0);
  const worstParts = offer.hurtMost.map(partsIn);
  const hardText = await clickEngineMove(on, turn);
  // the opponent's choice in the executed turn is one of the lowest cells of the row (a tie is the engine's pick of equals)
  expect(worstParts.some(parts => parts.every(part => hardText.includes(part))), `the history names the reply that hurts most (${offer.hurtMost.join(' | ')}); it reads: ${hardText.replace(/\s+/g, ' ').slice(0, 600)}`).toBe(true);
  const bestOnly = partsIn(offer.best).filter(part => !worstParts.some(parts => parts.includes(part)) && !partsIn(offer.own).includes(part));
  for (const part of bestOnly) expect(hardText, `the best row's ${part} is not played`).not.toContain(part);

  // arm two: the same turn with the setting off: the opponent's best row
  const offContext = await browser.newContext();
  contexts.push(offContext);
  const off = await offContext.newPage();
  await openPage(off, replay, false);
  await expect(off.getByRole('checkbox', { name: 'Hard mode' })).not.toBeChecked();
  const second = await evaluateTurn(off, turn);
  expect(second.own).toBe(offer.own);
  const offText = await clickEngineMove(off, turn);
  for (const part of partsIn(second.best)) expect(offText, `the best row's ${part} is played`).toContain(part);
}

for (const game of GAMES) {
  test(`${game.kind}: the opponent answers an engine click with the reply that hurts most (on) or its best row (off)`, async ({ browser }, testInfo) => {
    test.setTimeout(600_000);
    const replay = fixture(game.id);
    const contexts: BrowserContext[] = [];
    try {
      await runGame(contexts, browser, replay, game.turns);
    } catch (error) {
      // the pages of a self-made context are not in Playwright's failure screenshots
      for (const [index, page] of contexts.flatMap(context => context.pages()).entries()) await page.screenshot({ path: testInfo.outputPath(`page-${index}.png`) }).catch(() => {});
      throw error;
    } finally {
      for (const context of contexts) await context.close();
    }
  });
}
