import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { test, expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import type { ReplayData } from '@fulllifegames/replay-core';
import { evalStoreFileName, type SearchGuard } from './eval-store';
import { openReplayAnalysis } from './eval-store-seed';
import { installReplayEmbedCache } from './helpers';
import { variationPanel } from './dock-helpers';

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

type Names = ReadonlyMap<string, string>;

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

const SETTINGS = { mode: 'matrix', depth: 1, samples: 1 };

async function openPage(page: Page, replay: ReplayData, hardMode: boolean, turns: number[]): Promise<SearchGuard> {
  page.setDefaultTimeout(30_000);
  const { guard } = await openReplayAnalysis(page, replay, SETTINGS, { seed: evalStoreFileName(replay.id, SETTINGS, turns), prefs: hardMode ? { hardMode: true } : {} });
  return guard;
}

// Closes the menu again, so the pickers under it stay clickable.
async function withSetupBox(page: Page, check: (box: Locator) => Promise<void>): Promise<void> {
  await page.getByRole('button', { name: 'Setup', exact: true }).click();
  await check(page.getByRole('checkbox', { name: 'Opponent reads my move' }));
  await page.keyboard.press('Escape');
  await expect(page.getByRole('checkbox', { name: 'Opponent reads my move' })).toBeHidden();
}

interface Offer { own: string; best: string; hurtMost: string[] }

// The first report of a game lands the panel on the game report and closes the turn's view; a column click reopens it.
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

async function evaluateTurn(page: Page, guard: SearchGuard, turn: number): Promise<Offer> {
  const panel = page.locator('.ps-main-right .ps-eval-panel');
  await page.locator('input[type="range"]').fill(String(turn));
  const analyze = panel.getByRole('button', { name: /^Analyze this position/ });
  await expect(analyze).toBeEnabled({ timeout: 60_000 });
  await analyze.click();
  await guard.race(settleOnTurn(page, panel, turn));
  const label = async (column: number): Promise<string> =>
    ((await panel.locator('.ps-eval-column').nth(column).locator('.ps-eval-choice-main > span').nth(1).textContent()) ?? '').trim();
  const own = await label(0);
  const best = await label(1);
  await panel.getByRole('button', { name: 'Matrix', exact: true }).click();
  const titles = await panel.locator('td[title], td button[title]').evaluateAll(cells => cells.map(cell => cell.getAttribute('title') ?? ''));
  const cells = titles.flatMap(title => {
    const match = /^(.*?) × (.*?): .*? (\d+)% · /.exec(title);
    return match && match[1] === own ? [{ reply: match[2], pct: Number(match[3]) }] : [];
  });
  expect(cells.length, `the matrix holds cells of the row ${own} (${titles.length} titles)`).toBeGreaterThan(0);
  const lowest = Math.min(...cells.map(cell => cell.pct));
  guard.assertClean();
  return { own, best, hurtMost: cells.filter(cell => cell.pct === lowest).map(cell => cell.reply) };
}

// The variation's tip is a new position: its evaluation runs live, and the guard stands down from the click.
async function clickEngineMove(page: Page, guard: SearchGuard, turn: number): Promise<string> {
  guard.assertClean();
  guard.pause();
  const panel = page.locator('.ps-main-right .ps-eval-panel');
  await panel.locator('.ps-eval-column').first().locator('button.ps-eval-choice').first().click();
  await expect(page.getByText(/Variation tip: Turn/)).toBeVisible({ timeout: 90_000 });
  const history = variationPanel(page);
  await expect(history).toContainText(`Turn ${turn}`, { timeout: 90_000 });
  return (await history.textContent()) ?? '';
}

async function runGame(contexts: BrowserContext[], browser: Browser, replay: ReplayData, turns: number[]): Promise<void> {
  const names = namesOf(replay);
  const partsIn = (label: string): string[] => partsOf(label, names);
  // each arm gets its own browser context: the preferences live in localStorage, which pages of one context share
  const onContext = await browser.newContext();
  contexts.push(onContext);
  const on = await onContext.newPage();
  const onGuard = await openPage(on, replay, true, turns);
  await withSetupBox(on, box => expect(box).toBeChecked());
  let turn = turns[0];
  let offer = await evaluateTurn(on, onGuard, turn);
  for (const candidate of turns.slice(1)) {
    if (!offer.hurtMost.includes(offer.best)) break;
    turn = candidate;
    offer = await evaluateTurn(on, onGuard, turn);
  }
  expect(offer.hurtMost.length, 'the matrix names a reply that hurts the clicked move most').toBeGreaterThan(0);
  const worstParts = offer.hurtMost.map(partsIn);
  const hardText = await clickEngineMove(on, onGuard, turn);
  await expect(on.locator('.ps-dock-source').filter({ hasText: 'Opponent reads your move' })).toBeVisible();
  await expect(on.getByRole('button', { name: 'Turn off' })).toBeVisible();
  expect(worstParts.some(parts => parts.every(part => hardText.includes(part))), `the history names the reply that hurts most (${offer.hurtMost.join(' | ')}); it reads: ${hardText.replace(/\s+/g, ' ').slice(0, 600)}`).toBe(true);
  const bestOnly = partsIn(offer.best).filter(part => !worstParts.some(parts => parts.includes(part)) && !partsIn(offer.own).includes(part));
  for (const part of bestOnly) expect(hardText, `the best row's ${part} is not played`).not.toContain(part);
  await on.getByRole('button', { name: 'Turn off' }).click();
  await expect(on.getByText('Opponent reads your move')).toHaveCount(0);
  await withSetupBox(on, box => expect(box).not.toBeChecked());

  const offContext = await browser.newContext();
  contexts.push(offContext);
  const off = await offContext.newPage();
  const offGuard = await openPage(off, replay, false, turns);
  await withSetupBox(off, box => expect(box).not.toBeChecked());
  const second = await evaluateTurn(off, offGuard, turn);
  expect(second.own).toBe(offer.own);
  const offText = await clickEngineMove(off, offGuard, turn);
  await expect(off.getByText('Opponent reads your move')).toHaveCount(0);
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
