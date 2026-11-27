import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { test, expect, type Locator } from '@playwright/test';
import type { ReplayData } from '@fulllifegames/replay-core';
import { evalStoreFileName } from './eval-store';
import { openReplayAnalysis } from './eval-store-seed';
import { installReplayEmbedCache } from './helpers';
import { openVariationHistory, variationPanel } from './dock-helpers';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(here, '../../packages/eval-engine/test/fixtures', `${name}.json`), 'utf-8')) as ReplayData;

test.beforeAll(installReplayEmbedCache);
test.use({ actionTimeout: 60_000 });

// These rows read saved engine results (`EVAL_STORE=live` runs them live); the Auto row keeps its live search.
// Singles in auto runs the matrix on its early turns, which holds no line: that row sweeps with the tree on every turn.
const GAMES = [
  { kind: 'singles (Scarlet/Violet OU)', id: 'gen9ou-2658662321', mode: 'mcts' },
  { kind: 'VGC (Scarlet/Violet)', id: 'gen9vgc2026regi-2630452654', mode: 'auto' },
  { kind: 'Champions VGC', id: 'gen9championsvgc2026regma-2625939941', mode: 'auto' },
].map(game => ({ ...game, seed: evalStoreFileName(game.id, { mode: game.mode, depth: 1, samples: 1 }) }));

async function readRows(review: Locator) {
  return review.locator('.ps-eval-review-row').evaluateAll(rows => rows.map(row => ({
    turn: Number((row.querySelector('button')?.textContent ?? '').replace(/^T/, '')),
    side: row.closest('.ps-eval-review-side')?.querySelector('.name')?.textContent ?? '',
    plays: row.querySelectorAll('.ps-eval-review-line button').length,
  })));
}

const bare = (text: string) => text.replace(/ \([^)]*\)/g, '').replace(/ → [^:]+(?=:)/, '').trim();

for (const game of GAMES) {
  test(`${game.kind}: the Game review lists the graded turns, the graph marks them, ▶ Play opens the line`, async ({ page }) => {
    test.setTimeout(900_000);
    const replay = fixture(game.id);
    const started = Date.now();
    const lap = (step: string) => console.log(`${game.id}: ${step} at ${((Date.now() - started) / 1000).toFixed(1)} s`);
    const { guard } = await openReplayAnalysis(page, replay, { mode: game.mode, depth: 1, samples: 1 }, { seed: game.seed });
    lap('replay open');
    const panel = page.locator('.ps-main-right .ps-eval-panel');
    await panel.getByRole('button', { name: 'Analyze game' }).click();
    await guard.race(expect(panel.getByRole('button', { name: 'Re-analyze' })).toBeVisible({ timeout: 600_000 }));
    const review = panel.locator('.ps-eval-review');
    await guard.race(expect(review).toBeVisible({ timeout: 60_000 }));
    await expect(review).toContainText('Game review · what the engine would have played');
    const fold = review.getByRole('button', { name: /Game review/ });
    await expect(fold).toHaveAttribute('aria-expanded', 'false');
    await expect(review.locator('.ps-eval-review-row')).toHaveCount(0);
    await expect(fold).toContainText(/· \d+ graded turns?/);
    await fold.click();
    lap('report shown');

    const rows = await readRows(review);
    expect(rows.length, 'the game holds a graded turn').toBeGreaterThanOrEqual(1);
    const p1Rows = rows.filter(row => row.side === replay.players[0]).length;
    await expect(panel.locator('.ps-eval-graph circle[data-review-mark="p1"]')).toHaveCount(p1Rows);
    await expect(panel.locator('.ps-eval-graph rect[data-review-mark="p2"]')).toHaveCount(rows.length - p1Rows);

    const first = rows[0];
    await review.locator('.ps-eval-review-row').first().getByRole('button', { name: `T${first.turn}` }).click();
    await expect(panel.locator('.ps-eval-analysis')).toContainText(`Turn ${first.turn}`, { timeout: 30_000 });
    await expect(panel.locator('.ps-eval-analysis-row').first()).toBeInViewport({ ratio: 0.5 });
    await expect(panel.locator('.ps-eval-graph [data-review-mark]')).toHaveCount(rows.length);
    await expect(fold).toHaveAttribute('aria-expanded', 'true');
    await expect(review.locator('.ps-eval-review-row[aria-current="true"]').first()).toContainText(`T${first.turn}`);
    const second = rows.find(row => row.turn !== first.turn);
    if (second) {
      await review.getByRole('button', { name: `T${second.turn}`, exact: true }).first().click();
      await expect(panel.locator('.ps-eval-analysis')).toContainText(`Turn ${second.turn}`, { timeout: 30_000 });
      await expect(panel.locator('.ps-eval-analysis-row').first()).toBeInViewport({ ratio: 0.5 });
      await expect(review.locator('.ps-eval-review-row[aria-current="true"]').first()).toContainText(`T${second.turn}`);
      await expect(fold).toHaveAttribute('aria-expanded', 'true');
    }
    await panel.getByRole('button', { name: /Game report/ }).click();
    await expect(review).toBeVisible();
    await expect(fold).toHaveAttribute('aria-expanded', 'true');
    await expect(review.locator('.ps-eval-review-row[aria-current]')).toHaveCount(0);
    guard.assertClean();
    console.log(`${game.id}: worker requests up to the report and a turn: ${guard.requests().join(', ') || 'none'}`);

    const withLine = review.locator('.ps-eval-review-row').filter({ has: page.locator('.ps-eval-review-line button') });
    const playable = await withLine.count();
    const summary = `${rows.length} graded rows (${rows.map(entry => `T${entry.turn}`).join(', ')}), ${playable} with a line`;
    test.info().annotations.push({ type: 'rows', description: summary });
    console.log(`${game.id}: ${summary}`);
    if (playable === 0) return;
    const row = withLine.first();
    const turn = Number(((await row.getByRole('button').first().textContent()) ?? '').replace(/^T/, ''));
    const play = row.getByRole('button', { name: '▶ Play' }).first();
    guard.pause(); // the variation a line opens is a new position: its own evaluation may search
    expect((await play.boundingBox())!.height, 'the play button is inline').toBeLessThan(26);
    const tooltip = (await play.getAttribute('title')) ?? '';
    lap('▶ Play clicked');
    await play.click();
    const history = variationPanel(page);
    await expect(history).toContainText(/\d+ turns?/, { timeout: 240_000 });
    lap('variation history shown');
    await openVariationHistory(page);
    expect(await history.locator('strong').allTextContents(), `the history starts at turn ${turn}`).toContain(`Turn ${turn}`);
    console.log(`${game.id}: worker requests with ▶ Play: ${guard.requests().join(', ') || 'none'}`);
    const named = tooltip.split('\n').slice(1).filter(line => /^(T\d+|Replacement): /.test(line)).map(line => bare(line.replace(/^(T\d+|Replacement): /, '')));
    const marked = (await page.getByRole('group', { name: 'Forced dice' }).allTextContents()).flatMap(text => text.replace(/^Forced dice/, '').split(/(?=P[12] )/)).map(text => bare(text.replace(/^P[12] /, '')));
    for (const mark of marked.filter(text => text !== '')) expect(named, `the tooltip lists ${mark}`).toContain(mark);
    await expect(page.getByRole('button', { name: /Let it play out/ })).toBeEnabled();

    await panel.getByRole('button', { name: 'Back to the main line' }).click();
    await expect(review).toBeVisible();
    await expect(fold).toHaveAttribute('aria-expanded', 'true');
    await expect(panel.getByRole('button', { name: /← Game report/ })).toHaveCount(0);
    await review.locator('.ps-eval-review-row').filter({ has: page.locator('.ps-eval-review-line button') }).first().getByRole('button', { name: '▶ Play' }).first().click();
    const question = review.getByRole('alertdialog');
    await expect(question).toContainText('replace the existing variation');
    await expect(question).toBeInViewport();
    const replaceBox = (await question.getByRole('button', { name: 'Replace' }).boundingBox())!;
    const cancelBox = (await question.getByRole('button', { name: 'Cancel' }).boundingBox())!;
    expect(replaceBox.height, 'Replace on one line').toBeLessThan(40);
    expect(Math.abs(replaceBox.height - cancelBox.height), 'the buttons share a height').toBeLessThan(4);
    await question.getByRole('button', { name: 'Cancel' }).click();
    await expect(question).toHaveCount(0);
    lap('row done');
  });
}

test('singles in Auto: the graded early turns get their lines after the report, ▶ Play opens one', async ({ page }) => {
  test.setTimeout(1_500_000);
  const replay = fixture('gen9ou-2658662321');
  await openReplayAnalysis(page, replay, { mode: 'auto', depth: 1, samples: 1 });
  const panel = page.locator('.ps-main-right .ps-eval-panel');
  await panel.getByRole('button', { name: 'Analyze game' }).click();
  await expect(panel.getByRole('button', { name: 'Re-analyze' })).toBeVisible({ timeout: 600_000 });
  const review = panel.locator('.ps-eval-review');
  await expect(review).toBeVisible({ timeout: 60_000 });
  const progress = review.getByText(/Finding lines for graded turns: \d+ of \d+/);
  await expect(progress).toBeVisible({ timeout: 60_000 });
  await expect(progress).toBeHidden({ timeout: 900_000 });
  await review.getByRole('button', { name: /Game review/ }).click();

  const rows = await review.locator('.ps-eval-review-row').evaluateAll(entries => entries.map(row => ({
    turn: Number((row.querySelector('button')?.textContent ?? '').replace(/^T/, '')),
    plays: row.querySelectorAll('.ps-eval-review-line button').length,
  })));
  const held = await page.evaluate(turns => {
    const graph = (window as Window & { __psDebug?: { graph: { settings: ({ mode: string } | null)[]; results: ({ lines?: unknown[] } | null)[] } } }).__psDebug!.graph;
    return turns.map(turn => ({ turn, mode: graph.settings[turn - 1]?.mode ?? null, lines: graph.results[turn - 1]?.lines?.length ?? null }));
  }, rows.map(row => row.turn));
  const early = held.filter(entry => entry.mode === 'matrix');
  const summary = `${rows.length} graded rows, ${early.length} on the matrix (${early.map(entry => `T${entry.turn}: ${entry.lines} lines`).join(', ')})`;
  test.info().annotations.push({ type: 'rows', description: summary });
  console.log(`${replay.id}: ${summary}`);
  expect(early.length, 'the game grades an early matrix turn').toBeGreaterThanOrEqual(1);
  for (const entry of early) expect(entry.lines, `T${entry.turn} was searched`).not.toBeNull();

  const playable = rows.find(row => early.some(entry => entry.turn === row.turn && (entry.lines ?? 0) > 0) && row.plays > 0);
  expect(playable, 'an early graded turn shows a line with ▶ Play').toBeDefined();
  const row = review.locator('.ps-eval-review-row').filter({ has: page.getByRole('button', { name: `T${playable!.turn}`, exact: true }) }).first();
  await row.getByRole('button', { name: '▶ Play' }).first().click();
  const history = variationPanel(page);
  await expect(history).toContainText(/\d+ turns?/, { timeout: 240_000 });
  await openVariationHistory(page);
  expect(await history.locator('strong').allTextContents(), `the history starts at turn ${playable!.turn}`).toContain(`Turn ${playable!.turn}`);
});

test('VGC at 390 px: three review rows show their cards in view, the review stays open and marks the row', async ({ page }) => {
  test.setTimeout(900_000);
  const replay = fixture('gen9vgc2026regi-2630452654');
  await page.setViewportSize({ width: 390, height: 844 });
  const { guard } = await openReplayAnalysis(page, replay, { mode: 'auto', depth: 1, samples: 1 }, { seed: evalStoreFileName(replay.id, { mode: 'auto', depth: 1, samples: 1 }) });
  const panel = page.locator('.ps-main-right .ps-eval-panel');
  await panel.getByRole('button', { name: 'Analyze game' }).click();
  await guard.race(expect(panel.getByRole('button', { name: 'Re-analyze' })).toBeVisible({ timeout: 600_000 }));
  const review = panel.locator('.ps-eval-review');
  await guard.race(expect(review).toBeVisible({ timeout: 60_000 }));
  await review.getByRole('button', { name: /Game review/ }).click();
  const turns = [...new Set((await readRows(review)).map(row => row.turn))].slice(0, 3);
  expect(turns.length, 'the game holds graded turns').toBeGreaterThanOrEqual(1);
  for (const turn of turns) {
    await review.getByRole('button', { name: `T${turn}`, exact: true }).first().click();
    await expect(panel.locator('.ps-eval-analysis')).toContainText(`Turn ${turn}`, { timeout: 30_000 });
    await expect(panel.locator('.ps-eval-analysis-row').first()).toBeInViewport({ ratio: 0.5 });
    await expect(review).toBeVisible();
    await expect(review.locator('.ps-eval-review-row[aria-current="true"]').first()).toContainText(`T${turn}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal overflow').toBe(true);
  }
  guard.assertClean();
});
