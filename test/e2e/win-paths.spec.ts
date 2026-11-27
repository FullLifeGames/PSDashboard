import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { test, expect } from '@playwright/test';
import type { ReplayData } from '@fulllifegames/replay-core';
import { evalStoreFileName } from './eval-store';
import { openReplayAnalysis } from './eval-store-seed';
import { installReplayEmbedCache } from './helpers';
import { openVariationHistory, variationPanel } from './dock-helpers';

// The game's sweep and the job's finished answer read saved engine results (scripts/capture-eval-store.mjs;
// EVAL_STORE=live runs both live, and the reload half then reads the answer the live job saved).
const here = dirname(fileURLToPath(import.meta.url));
const read = (dir: string, name: string) => JSON.parse(readFileSync(join(here, dir, `${name}.json`), 'utf-8')) as ReplayData;
const engineFixture = (name: string) => read('../../packages/eval-engine/test/fixtures', name);
const feedbackFixture = (name: string) => read('../e2e-feedback/fixtures', name);

test.beforeAll(installReplayEmbedCache);
test.use({ actionTimeout: 60_000 });

const GAMES = [
  { kind: 'singles (Gen 6 OU 649664)', replay: () => engineFixture('smogtours-gen6ou-649664') },
  { kind: 'Champions VGC 2695803506 (doubles, 1 v 1)', replay: () => feedbackFixture('gen9championsvgc2026regmc-2695803506') },
  { kind: 'VGC 2629703929 (doubles, 1 v 2)', replay: () => feedbackFixture('gen9vgc2026regi-2629703929') },
  { kind: 'Doubles OU 912045', replay: () => feedbackFixture('smogtours-gen9doublesou-912045') },
];

const winnerOf = (replay: ReplayData): string => replay.log.match(/\|win\|(.+)/)![1].trim();

const SETTINGS = { mode: 'matrix', depth: 1, samples: 1 };

const bare = (text: string) => text.replace(/ \([^)]*\)/g, '').replace(/ → [^:]+(?=:)/, '').trim();

for (const game of GAMES) {
  test(`${game.kind}: the Endgame row, three steps in order, ▶ Play of a luck path plays to the win`, async ({ page }) => {
    test.setTimeout(1_500_000);
    const replay = game.replay();
    const winner = winnerOf(replay);
    const loser = replay.players.find(name => name !== winner)!;
    const { guard } = await openReplayAnalysis(page, replay, SETTINGS, { seed: evalStoreFileName(replay.id, SETTINGS) });
    const panel = page.locator('.ps-main-right .ps-eval-panel');
    await panel.getByRole('button', { name: 'Analyze game' }).click();
    await guard.race(expect(panel.getByRole('button', { name: 'Re-analyze' })).toBeVisible({ timeout: 700_000 }));
    const review = panel.locator('.ps-eval-review');
    await guard.race(expect(review).toBeVisible({ timeout: 60_000 }));
    await review.getByRole('button', { name: /Game review/ }).click();

    const entry = review.getByRole('button', { name: new RegExp(`^Endgame · T\\d+ · How could ${loser} have won\\?$`) });
    await expect(entry).toBeVisible();
    await expect(review.getByRole('button', { name: /How could .* have won\?/ })).toHaveCount(1);
    guard.assertClean();
    await entry.click();
    const win = review.getByRole('region', { name: `How could ${loser} have won?` });
    await expect(win).toBeVisible();

    const steps = win.locator('[data-step]');
    await guard.race(expect(steps).toHaveCount(3, { timeout: 400_000 }));
    const titles = ['1 · A stronger play', '2 · Luck', `3 · A mistake by ${winner}`];
    expect(await steps.locator('.ps-winpaths-step-title').allTextContents()).toEqual(titles);
    const sentences = /^(None within 3 turns\.|None within 3 turns at 1 in 1,000 or better\.|Stopped at the search limit; nothing found so far\.)$/;
    const summary: string[] = [];
    for (const kind of ['stronger', 'luck', 'mistake']) {
      const step = win.locator(`[data-step="${kind}"]`);
      const plays = await step.getByRole('button', { name: '▶ Play' }).count();
      if (plays === 0) await expect(step.locator('.ps-winpaths-empty'), `${kind} has a sentence`).toHaveText(sentences);
      else await expect(step.locator('.ps-winpaths-headline'), `${kind} says what it found`).toBeVisible();
      summary.push(`${kind}: ${plays > 0 ? 'found' : (await step.locator('.ps-winpaths-empty').textContent())}`);
    }
    test.info().annotations.push({ type: 'steps', description: `${loser}: ${summary.join(' | ')}` });
    const picker = win.getByRole('group', { name: 'Endgame turn' });
    if (await picker.count() > 0) expect((await picker.getByRole('button').allTextContents())[0]).toMatch(/^T\d+$/);

    await review.getByRole('button', { name: /^Endgame · T\d+/ }).click();
    await expect(win).toHaveCount(0);
    await review.getByRole('button', { name: /^Endgame · T\d+/ }).click();
    await expect(win.locator('[data-step]')).toHaveCount(3, { timeout: 30_000 });
    guard.assertClean();

    await page.reload();
    await expect(page.getByText(replay.players[0], { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await panel.getByRole('button', { name: 'Analyze game' }).click();
    await guard.race(expect(panel.getByRole('button', { name: 'Re-analyze' })).toBeVisible({ timeout: 700_000 }));
    await review.getByRole('button', { name: /Game review/ }).click();
    await review.getByRole('button', { name: /^Endgame · T\d+/ }).click();
    await expect(win.locator('[data-step]')).toHaveCount(3, { timeout: 30_000 });
    expect(await win.locator('.ps-winpaths-step-title').allTextContents(), 'the reload shows the stored paths').toEqual(titles);
    guard.assertClean();
    guard.pause();

    const luck = win.locator('[data-step="luck"]');
    const play = luck.getByRole('button', { name: '▶ Play' });
    if (await play.count() === 0) return;
    const named = (((await play.getAttribute('title')) ?? '').split('\n').slice(1).filter(line => /^(T\d+|Replacement): /.test(line))).map(line => bare(line.replace(/^(T\d+|Replacement): /, '')));
    await play.click();
    const history = variationPanel(page);
    await expect(history).toContainText(/\d+ turns?/, { timeout: 240_000 });
    await expect(page.locator('.ps-branch-ended').first()).toContainText(`${loser} wins this variation.`, { timeout: 120_000 });
    await openVariationHistory(page);
    const marked = (await page.getByRole('group', { name: 'Forced dice' }).allTextContents()).flatMap(text => text.replace(/^Forced dice/, '').split(/(?=P[12] )/)).map(text => bare(text.replace(/^P[12] /, '')));
    for (const mark of marked.filter(text => text !== '')) expect(named, `the tooltip lists ${mark}`).toContain(mark);
  });
}
