import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { test, expect, type Locator, type Page } from '@playwright/test';
import type { ReplayData } from '@fulllifegames/replay-core';
import { installReplayEmbedCache, routeOfflineFixtures } from './helpers';
import { openVariationHistory, variationPanel } from './dock-helpers';

/**
 * Round 89 (#104), step G3: the Lines section under a turn and the click ▶ Play. One test per game type: the tree searches one turn
 * (the panel's own "Analyze this position"), the section shows its lines, and the click on ▶ Play opens a variation that plays the
 * line's turns with the line's dice: the history lists the line's turns, and the forced dice it marks are the dice the tooltip of
 * the button lists (the chips are the shown ones among them). Singles, Doubles OU, VGC, Champions OU and Champions VGC.
 */
const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(here, '../../packages/eval-engine/test/fixtures', `${name}.json`), 'utf-8')) as ReplayData;

test.beforeAll(installReplayEmbedCache);

const GAMES = [
  { kind: 'singles (Gen 6 OU)', id: 'smogtours-gen6ou-655336', turns: [8, 12] },
  { kind: 'Doubles OU', id: 'gen9doublesou-2694811367', turns: [4, 6] },
  { kind: 'VGC (Scarlet/Violet)', id: 'gen9vgc2026regi-2630452654', turns: [4, 6] },
  { kind: 'Champions OU', id: 'gen9championsou-2691703002', turns: [8, 12] },
  { kind: 'Champions VGC', id: 'gen9championsvgc2026regma-2625939941', turns: [4, 6] },
];

async function loadReplay(page: Page, replay: ReplayData) {
  await routeOfflineFixtures(page);
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.setItem('ps-replay-interceptor:eval-pool', '2');
    localStorage.setItem('ps-replay-interceptor:eval-prefs', JSON.stringify({ depth: 1, samples: 1, mode: 'mcts', auto: false, tera: 'auto' }));
  });
  await page.reload();
  // Registered last, so it answers before routeOfflineFixtures' default replay.
  await page.route('**/replay.pokemonshowdown.com/**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(replay),
  }));
  await page.locator('input[type="text"]').first().fill(replay.id);
  await page.locator('button', { hasText: 'Load' }).click();
  await expect(page.getByText(replay.players[0], { exact: true }).first()).toBeVisible({ timeout: 30_000 });
}

/** What a block of the Lines section shows, read from the page. */
async function readBlock(block: Locator) {
  const rows = await block.locator('.ps-eval-line-turn').evaluateAll(nodes => nodes.map(node => ({
    turn: node.querySelector('.t')?.textContent ?? '',
    text: node.textContent ?? '',
    chips: [...node.querySelectorAll('.ps-line-chip')].map(chip => chip.textContent ?? ''),
  })));
  const title = (await block.getByRole('button', { name: '▶ Play' }).getAttribute('title')) ?? '';
  return { rows, dice: title.split('\n').slice(1).filter(line => /^(T\d+|Replacement): /.test(line)).map(line => line.replace(/^(T\d+|Replacement): /, '')) };
}

/** A die's words without its chance or its knock-out count: what the history's mark says. */
const bare = (text: string) => text.replace(/ \([^)]*\)/g, '').trim();

for (const game of GAMES) {
  test(`${game.kind}: ▶ Play plays the line's turns and dice`, async ({ page }) => {
    test.setTimeout(480_000);
    const replay = fixture(game.id);
    await loadReplay(page, replay);
    const panel = page.locator('.ps-main-right .ps-eval-panel');
    const slider = page.locator('input[type="range"]');
    let block: Locator | null = null;
    let turn = 0;
    for (const candidate of game.turns) {
      await slider.fill(String(candidate));
      const analyze = panel.getByRole('button', { name: 'Analyze this position (MCTS)' });
      await expect(analyze).toBeEnabled({ timeout: 60_000 });
      await analyze.click();
      await expect(panel.locator('.ps-eval-analysis')).toContainText(`Turn ${candidate}`, { timeout: 400_000 });
      await expect(panel.locator('.ps-eval-lines')).toBeVisible();
      turn = candidate;
      // the longest line of the turn (steps counted as the rows that carry a turn number); a turn with no line tries the next candidate
      const blocks = panel.locator('.ps-eval-line-block');
      const count = await blocks.count();
      let best = -1;
      for (let index = 0; index < count; index += 1) {
        const rows = await blocks.nth(index).locator('.ps-eval-line-turn .t').allTextContents();
        const length = rows.filter(text => text !== '').length;
        if (length > best) { best = length; block = blocks.nth(index); }
      }
      if (best >= 2) break;
    }
    expect(block, 'a turn of the game holds a line').not.toBeNull();
    const line = await readBlock(block!);
    const lineTurns = line.rows.map(row => row.turn).filter(label => label !== '');
    expect(lineTurns[0]).toBe(`T${turn}`);

    await block!.getByRole('button', { name: '▶ Play' }).click();
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
