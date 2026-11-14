import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { test, expect, type Locator, type Page } from '@playwright/test';
import type { ReplayData } from '@fulllifegames/replay-core';
import { installReplayEmbedCache, routeOfflineFixtures } from './helpers';
import { openVariationHistory, variationPanel } from './dock-helpers';

/**
 * Round 89 (#104), step G4: the Game review under the game report. One test per game type: the sweep analyzes the whole game, the
 * report view lists the turns the cards grade per player, the graph carries one mark per listed row (a circle for player 1, a square
 * for player 2), a click on a listed turn opens it, and ▶ Play on a row's line opens a variation that plays the line from that turn.
 * Singles, VGC (Scarlet/Violet) and Champions VGC (short games: the sweep is the cost).
 */
const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(here, '../../packages/eval-engine/test/fixtures', `${name}.json`), 'utf-8')) as ReplayData;

test.beforeAll(installReplayEmbedCache);
// A red row fails in minutes, not after the test's whole budget: no single click or assertion waits longer than this (G4c).
test.use({ actionTimeout: 60_000 });

/** Singles runs the matrix on its early turns in auto, and a matrix turn holds no line: that row sweeps with the tree on every turn. */
const GAMES = [
  { kind: 'singles (Scarlet/Violet OU)', id: 'gen9ou-2658662321', mode: 'mcts' },
  { kind: 'VGC (Scarlet/Violet)', id: 'gen9vgc2026regi-2630452654', mode: 'auto' },
  { kind: 'Champions VGC', id: 'gen9championsvgc2026regma-2625939941', mode: 'auto' },
];

async function loadReplay(page: Page, replay: ReplayData, mode: string) {
  await routeOfflineFixtures(page);
  await page.goto('/');
  await page.evaluate(engineMode => {
    localStorage.setItem('ps-replay-interceptor:eval-pool', '2');
    localStorage.setItem('ps-replay-interceptor:eval-prefs', JSON.stringify({ depth: 1, samples: 1, mode: engineMode, auto: false, tera: 'auto' }));
  }, mode);
  await page.reload();
  // Registered last, so it answers before routeOfflineFixtures' default replay.
  await page.route('**/replay.pokemonshowdown.com/**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(replay),
  }));
  await page.locator('input[type="text"]').first().fill(replay.id);
  await page.locator('button', { hasText: 'Load' }).click();
  await expect(page.getByText(replay.players[0], { exact: true }).first()).toBeVisible({ timeout: 30_000 });
}

/** The rows of the review: the turn, the side's list and whether a line has its play button. */
async function readRows(review: Locator) {
  return review.locator('.ps-eval-review-row').evaluateAll(rows => rows.map(row => ({
    turn: Number((row.querySelector('button')?.textContent ?? '').replace(/^T/, '')),
    side: row.closest('.ps-eval-review-side')?.querySelector('.name')?.textContent ?? '',
    plays: row.querySelectorAll('.ps-eval-review-line button').length,
  })));
}

/** A die's words without its chance or its knock-out count: what the history's mark says. */
const bare = (text: string) => text.replace(/ \([^)]*\)/g, '').replace(/ → [^:]+(?=:)/, '').trim();

for (const game of GAMES) {
  test(`${game.kind}: the Game review lists the graded turns, the graph marks them, ▶ Play opens the line`, async ({ page }) => {
    test.setTimeout(900_000);
    const replay = fixture(game.id);
    await loadReplay(page, replay, game.mode);
    const panel = page.locator('.ps-main-right .ps-eval-panel');
    await panel.getByRole('button', { name: 'Analyze game' }).click();
    await expect(panel.getByRole('button', { name: 'Re-analyze' })).toBeVisible({ timeout: 600_000 });
    const review = panel.locator('.ps-eval-review');
    await expect(review).toBeVisible({ timeout: 60_000 });
    await expect(review).toContainText('Game review · what the engine would have played');

    const rows = await readRows(review);
    expect(rows.length, 'the game holds a graded turn').toBeGreaterThanOrEqual(1);
    // the marks equal the list: a circle per row of player 1, a square per row of player 2
    const p1Rows = rows.filter(row => row.side === replay.players[0]).length;
    await expect(panel.locator('.ps-eval-graph circle[data-review-mark="p1"]')).toHaveCount(p1Rows);
    await expect(panel.locator('.ps-eval-graph rect[data-review-mark="p2"]')).toHaveCount(rows.length - p1Rows);

    // a click on a listed turn opens it; the marks stay on the graph
    const first = rows[0];
    await review.locator('.ps-eval-review-row').first().getByRole('button', { name: `T${first.turn}` }).click();
    await expect(panel.locator('.ps-eval-analysis')).toContainText(`Turn ${first.turn}`, { timeout: 30_000 });
    await expect(panel.locator('.ps-eval-graph [data-review-mark]')).toHaveCount(rows.length);
    await panel.getByRole('button', { name: /Game report/ }).click();
    await expect(review).toBeVisible();

    // ▶ Play on a row with a line: the variation plays the line from the graded turn with the dice the tooltip lists
    const withLine = review.locator('.ps-eval-review-row').filter({ has: page.locator('.ps-eval-review-line button') });
    const playable = await withLine.count();
    const summary = `${rows.length} graded rows (${rows.map(entry => `T${entry.turn}`).join(', ')}), ${playable} with a line`;
    test.info().annotations.push({ type: 'rows', description: summary });
    console.log(`${game.id}: ${summary}`);
    if (playable === 0) return;
    const row = withLine.first();
    const turn = Number(((await row.getByRole('button').first().textContent()) ?? '').replace(/^T/, ''));
    const play = row.getByRole('button', { name: '▶ Play' }).first();
    // the button stands inline in the row's 10 px text, not as a full-size button (round 89, G4b)
    expect((await play.boundingBox())!.height, 'the play button is inline').toBeLessThan(26);
    const tooltip = (await play.getAttribute('title')) ?? '';
    await play.click();
    const history = variationPanel(page);
    await expect(history).toContainText(/\d+ turns?/, { timeout: 240_000 });
    await openVariationHistory(page);
    expect(await history.locator('strong').allTextContents(), `the history starts at turn ${turn}`).toContain(`Turn ${turn}`);
    const named = tooltip.split('\n').slice(1).filter(line => /^(T\d+|Replacement): /.test(line)).map(line => bare(line.replace(/^(T\d+|Replacement): /, '')));
    const marked = (await page.getByRole('group', { name: 'Forced dice' }).allTextContents()).flatMap(text => text.replace(/^Forced dice/, '').split(/(?=P[12] )/)).map(text => bare(text.replace(/^P[12] /, '')));
    for (const mark of marked.filter(text => text !== '')) expect(named, `the tooltip lists ${mark}`).toContain(mark);
    await expect(page.getByRole('button', { name: /Let it play out/ })).toBeEnabled();

    // a second ▶ Play over the open variation asks first, under the line that was clicked and on screen (G4b: it stood out of sight).
    // While the variation is on screen the panel shows its evaluation, never the report: back to the main line, then to the report.
    await page.getByRole('group', { name: 'Line selector' }).getByRole('button', { name: 'Main line' }).click();
    const back = panel.getByRole('button', { name: /Game report/ });
    await expect(review.or(back)).toBeVisible();
    if (await back.count()) await back.click();
    await expect(review).toBeVisible();
    await review.locator('.ps-eval-review-row').filter({ has: page.locator('.ps-eval-review-line button') }).first().getByRole('button', { name: '▶ Play' }).first().click();
    const question = review.getByRole('alertdialog');
    await expect(question).toContainText('replace the existing variation');
    await expect(question).toBeInViewport();
    await question.getByRole('button', { name: 'Cancel' }).click();
    await expect(question).toHaveCount(0);
  });
}
