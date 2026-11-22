import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { test, expect } from '@playwright/test';
import type { ReplayData } from '@fulllifegames/replay-core';
import { evalStoreFileName } from './eval-store';
import { openReplayAnalysis } from './eval-store-seed';
import { installReplayEmbedCache } from './helpers';
import { openVariationHistory, variationPanel } from './dock-helpers';

/**
 * Round 89 (#130), step G8b: "How could <player> have won?" under the Game review's Endgame row. One test per game type: the sweep
 * analyzes the game, the review offers the row for the player who lost (and for nobody else), a click opens the panel, the three
 * steps arrive in the ruled order, each with a line and its play button or one sentence, and a luck path that was found plays to the
 * loser's win under ▶ Play, its forced-dice marks among the dice of the button's tooltip. Closing the panel and opening the row again
 * answers from the client's memo. Gen 6 OU 649664 (singles, the scene of the issue), Champions VGC 2695803506 and VGC 2629703929
 * (doubles, 1 v 1 and 1 v 2) and Doubles OU 912045.
 *
 * Round 90 (#222), step E3: the sweep before the row is the game's analysis, which the saved engine results hold (scripts/capture-eval-store.mjs;
 * `EVAL_STORE=live` runs it live). The row's own search, "How could X have won?", is an on-request job that stores nothing, so it runs live
 * in every game type: the guard stands down from the click on the Endgame row.
 */
const here = dirname(fileURLToPath(import.meta.url));
const read = (dir: string, name: string) => JSON.parse(readFileSync(join(here, dir, `${name}.json`), 'utf-8')) as ReplayData;
const engineFixture = (name: string) => read('../../packages/eval-engine/test/fixtures', name);
const feedbackFixture = (name: string) => read('../e2e-feedback/fixtures', name);

test.beforeAll(installReplayEmbedCache);
// A red row fails in minutes, not after the test's whole budget: no click or assertion waits longer than this.
test.use({ actionTimeout: 60_000 });

const GAMES = [
  { kind: 'singles (Gen 6 OU 649664)', replay: () => engineFixture('smogtours-gen6ou-649664') },
  { kind: 'Champions VGC 2695803506 (doubles, 1 v 1)', replay: () => feedbackFixture('gen9championsvgc2026regmc-2695803506') },
  { kind: 'VGC 2629703929 (doubles, 1 v 2)', replay: () => feedbackFixture('gen9vgc2026regi-2629703929') },
  { kind: 'Doubles OU 912045', replay: () => feedbackFixture('smogtours-gen9doublesou-912045') },
];

const winnerOf = (replay: ReplayData): string => replay.log.match(/\|win\|(.+)/)![1].trim();

const SETTINGS = { mode: 'matrix', depth: 1, samples: 1 };

/** A die's words without its chance or its knock-out count: what the history's mark says. */
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

    // the row stands for the player who lost and for nobody else
    const entry = review.getByRole('button', { name: new RegExp(`^Endgame · T\\d+ · How could ${loser} have won\\?$`) });
    await expect(entry).toBeVisible();
    await expect(review.getByRole('button', { name: /How could .* have won\?/ })).toHaveCount(1);
    guard.assertClean();
    guard.pause(); // the job behind the row searches live
    await entry.click();
    const win = review.getByRole('region', { name: `How could ${loser} have won?` });
    await expect(win).toBeVisible();

    // three steps, in the order of the ruling, each one as it finishes
    const steps = win.locator('[data-step]');
    await expect(steps).toHaveCount(3, { timeout: 400_000 });
    expect(await steps.locator('.ps-winpaths-step-title').allTextContents()).toEqual(['1 · A stronger play', '2 · Luck', `3 · A mistake by ${winner}`]);
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
    // the picker lists the endgame's turns, the first one is the one that was searched
    const picker = win.getByRole('group', { name: 'Endgame turn' });
    if (await picker.count() > 0) expect((await picker.getByRole('button').allTextContents())[0]).toMatch(/^T\d+$/);

    // a second open reads the memo: close, open again, the steps are there at once
    await review.getByRole('button', { name: /^Endgame · T\d+/ }).click();
    await expect(win).toHaveCount(0);
    await review.getByRole('button', { name: /^Endgame · T\d+/ }).click();
    await expect(win.locator('[data-step]')).toHaveCount(3, { timeout: 30_000 });

    // a found luck path plays to the loser's win with the dice its tooltip lists
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
