import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { test, expect, type Locator, type Page } from '@playwright/test';
import type { ReplayData } from '@fulllifegames/replay-core';
import { evalStoreFileName } from './eval-store';
import { openReplayAnalysis } from './eval-store-seed';
import { installReplayEmbedCache } from './helpers';
import { openVariationHistory, variationPanel } from './dock-helpers';

/**
 * The Lines section under a turn and the click ▶ Play. One test per game type: the tree searches one turn
 * (the panel's own "Analyze this position"), the section shows its lines, and the click on ▶ Play opens a variation that plays the
 * line's turns with the line's dice: the history lists the line's turns, and the forced dice it marks are the dice the tooltip of
 * the button lists (the chips are the shown ones among them). Singles, Doubles OU, VGC, Champions OU and Champions VGC.
 *
 * The row judges the Lines section and the click, not the search, so "Analyze this position" reads the saved
 * result of the turn (the capture analyzed the candidate turns, scripts/capture-eval-store.mjs; `EVAL_STORE=live` runs the row live).
 * The variation ▶ Play opens is a new position: its own evaluation runs live, and the guard stands down from the click.
 */
const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(here, '../../packages/eval-engine/test/fixtures', `${name}.json`), 'utf-8')) as ReplayData;

test.beforeAll(installReplayEmbedCache);

const SETTINGS = { mode: 'mcts', depth: 1, samples: 1 };
const GAMES = [
  { kind: 'singles (Gen 6 OU)', id: 'smogtours-gen6ou-655336', turns: [8, 12] },
  { kind: 'Doubles OU', id: 'smogtours-gen9doublesou-912884', turns: [5, 8, 11] },
  { kind: 'VGC (Scarlet/Violet)', id: 'gen9vgc2026regi-2630452654', turns: [4, 6] },
  { kind: 'Champions OU', id: 'gen9championsou-2691703002', turns: [8, 12] },
  { kind: 'Champions VGC', id: 'gen9championsvgc2026regma-2625939941', turns: [3, 5] },
].map(game => ({ ...game, seed: evalStoreFileName(game.id, SETTINGS, game.turns) }));

/** What a block of the Lines section shows, read from the page. */
async function readBlock(block: Locator) {
  const rows = await block.locator('.ps-eval-line-turn').evaluateAll(nodes => nodes.map(node => ({
    turn: node.querySelector('.t')?.textContent ?? '',
    text: node.textContent ?? '',
    chips: [...node.querySelectorAll('.ps-lines-chip')].map(chip => chip.textContent ?? ''),
  })));
  const title = (await block.getByRole('button', { name: '▶ Play' }).getAttribute('title')) ?? '';
  return { rows, dice: title.split('\n').slice(1).filter(line => /^(T\d+|Replacement): /.test(line)).map(line => line.replace(/^(T\d+|Replacement): /, '')) };
}

/**
 * The panel lands on the game report when the first report of a game appears (`useReportView`), which can
 * happen right after the analysis of a turn finishes: the turn's view then closes under the test (Champions OU read
 * "element is not visible" for the whole timeout). A click on the turn's column in the graph opens the turn's view again; the loop
 * accepts the view only when it stays for a moment.
 */
async function settleOnTurn(page: Page, panel: Locator, turn: number) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    // a click on the turn's column of the graph opens the turn's view whatever the panel shows
    await panel.locator(`svg rect[data-turn="${turn}"]`).first().click({ force: true });
    await expect(panel.locator('.ps-eval-analysis')).toContainText(`Turn ${turn}`, { timeout: 60_000 });
    if (await panel.locator('.ps-eval-lines').isVisible()) {
      await page.waitForTimeout(1500);
      if (await panel.locator('.ps-eval-lines').isVisible()) return;
    }
  }
  await expect(panel.locator('.ps-eval-lines')).toBeVisible();
}

/**
 * The Lines section starts closed under its `Lines` toggle, like the Explanation: a turn shows no
 * line until the toggle opens it. Check it closed, open it, check the lines are there.
 */
async function openLines(panel: Locator) {
  const toggle = panel.locator('.ps-eval-lines').getByRole('button', { name: 'Lines', exact: true });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(panel.locator('.ps-eval-line-block')).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
}

/** A die's words without its chance or its knock-out count: what the history's mark says. */
const bare = (text: string) => text.replace(/ \([^)]*\)/g, '').replace(/ → [^:]+(?=:)/, '').trim();

for (const game of GAMES) {
  test(`${game.kind}: ▶ Play plays the line's turns and dice`, async ({ page }) => {
    test.setTimeout(900_000);
    const replay = fixture(game.id);
    const { guard } = await openReplayAnalysis(page, replay, SETTINGS, { seed: game.seed });
    const panel = page.locator('.ps-main-right .ps-eval-panel');
    const slider = page.locator('input[type="range"]');
    let block: Locator | null = null;
    let turn = 0;
    let longest = -1;
    for (const candidate of game.turns) {
      await slider.fill(String(candidate));
      // after the first report of the game the panel shows the overview: the graph's column opens the turn's own view
      const column = panel.locator(`svg rect[data-turn="${candidate}"]`).first();
      if (await column.count() > 0) await column.click({ force: true });
      const analyze = panel.getByRole('button', { name: 'Analyze this position (MCTS)' });
      await expect(analyze).toBeEnabled({ timeout: 60_000 });
      await analyze.click();
      // the graph names the turn's result once the search has finished (the turn's own view may have closed by then, see below)
      const produced = panel.locator('svg title').filter({ hasText: new RegExp(`\\(what turn ${candidate} produced\\)`) });
      await guard.race(expect(produced.or(panel.locator('.ps-eval-analysis').filter({ hasText: `Turn ${candidate}` })).first()).toBeAttached({ timeout: 400_000 }));
      await settleOnTurn(page, panel, candidate);
      await openLines(panel);
      turn = candidate;
      // the longest line of the turn (steps counted as the rows that carry a turn number); a turn with no line tries the next candidate
      const blocks = panel.locator('.ps-eval-line-block');
      const count = await blocks.count();
      let best = -1;
      block = null;
      for (let index = 0; index < count; index += 1) {
        const rows = await blocks.nth(index).locator('.ps-eval-line-turn .t').allTextContents();
        const length = rows.filter(text => text !== '').length;
        if (length > best) { best = length; block = blocks.nth(index); }
      }
      longest = best;
      if (best >= 2) break;
    }
    // the last candidate may hold a one-turn line: the click is still tested on it
    expect(block, 'a turn of the game holds a line').not.toBeNull();
    expect(longest, 'the line has a step').toBeGreaterThanOrEqual(1);
    console.log(`${game.id}: the longest line of turn ${turn} has ${longest} steps${guard.requests().length ? `; worker requests: ${guard.requests().join(', ')}` : ''}`);
    const line = await readBlock(block!);
    const lineTurns = line.rows.map(row => row.turn).filter(label => label !== '');
    expect(lineTurns[0]).toBe(`T${turn}`);
    guard.assertClean();
    guard.pause(); // the variation ▶ Play opens is a new position: its own evaluation may search

    // the turn's view can be rebuilt under the test (see settleOnTurn), and the Lines toggle then starts closed again: open it again and retry
    await expect(async () => {
      const toggle = panel.locator('.ps-eval-lines').getByRole('button', { name: 'Lines', exact: true });
      if ((await toggle.getAttribute('aria-expanded', { timeout: 5_000 })) !== 'true') await toggle.click({ timeout: 5_000 });
      await block!.getByRole('button', { name: '▶ Play' }).click({ timeout: 10_000 });
    }).toPass({ timeout: 120_000 });
    // an existing variation would ask first; the page has none
    const history = variationPanel(page);
    await expect(history).toContainText(`${lineTurns.length} ${lineTurns.length === 1 ? 'turn' : 'turns'}`, { timeout: 240_000 });
    await openVariationHistory(page);
    // the history lists the line's turns, numbered as the section numbers them
    const listed = await history.locator('strong').allTextContents();
    for (const label of lineTurns) expect(listed, `the history lists ${label}`).toContain(`Turn ${label.slice(1)}`);
    // the forced dice it marks are the dice the button's tooltip lists, and every chip of the line is among them
    const marked = (await page.getByRole('group', { name: 'Forced dice' }).allTextContents()).flatMap(text => text.replace(/^Forced dice/, '').split(/(?=P[12] )/)).map(text => bare(text.replace(/^P[12] /, '')));
    const named = line.dice.map(bare);
    for (const mark of marked.filter(text => text !== '')) expect(named, `the tooltip lists ${mark}`).toContain(mark);
    // the pointer stands on the tip of the variation, where Let it play out continues from
    await expect(page.getByRole('button', { name: /Let it play out/ })).toBeEnabled();
    for (const chip of line.rows.flatMap(row => row.chips).filter(text => !text.includes('KO'))) expect(marked, `the history marks ${chip}`).toContain(bare(chip));
  });
}
