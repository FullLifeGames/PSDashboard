import { test, expect } from '@playwright/test';
import { emptySmogon, routeSmogon } from './smogon-routes';
import { fixturePath, installReplayEmbedCache, routeOfflineFixtures } from './helpers';

test.beforeAll(installReplayEmbedCache);

test.describe('PS Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await routeOfflineFixtures(page);
    await page.goto('/');
  });

  test('analyzes the whole game into an eval graph', async ({ page }) => {
    test.setTimeout(240_000);
    await page.evaluate(() => {
      localStorage.setItem('ps-replay-interceptor:eval-pool', '2');
      localStorage.setItem('ps-replay-interceptor:perf', '1');
      localStorage.setItem('ps-replay-interceptor:eval-prefs', JSON.stringify({ depth: 1, samples: 1, auto: false, tera: 'auto' }));
    });
    await page.reload();
    await page.locator('button', { hasText: 'Load' }).click();
    await expect(page.getByText('TestPlayer1', { exact: true }).first()).toBeVisible({ timeout: 10000 });

    const panel = page.locator('.ps-main-right .ps-eval-panel');
    await panel.locator('button', { hasText: 'Analyze game' }).click();
    await expect(panel.locator('.ps-eval-graph')).toBeVisible({ timeout: 180_000 });
    expect(await panel.locator('.ps-eval-graph circle').count()).toBeGreaterThan(0);
    // The sweep finishes and offers a re-run.
    await expect(panel.locator('button', { hasText: 'Re-analyze' })).toBeVisible({ timeout: 60_000 });

    // One IndexedDB read per sweep: the run prefetches the replay's stored
    // evals instead of reading once per turn (the perf flag set above
    // mirrors the stage table on window.__EVAL_PERF__).
    const perf = await page.evaluate(() => (window as unknown as { __EVAL_PERF__?: { stages: Record<string, { count: number }> } }).__EVAL_PERF__);
    expect(perf?.stages['cache-load']?.count).toBe(1);

    // A completed sweep produces the game-level report.
    await expect(panel.locator('.ps-eval-report')).toBeVisible();
    await expect(panel.locator('.ps-eval-report')).toContainText('Game report');

    // Turn 0: the team-preview lead evaluation adds its own graph point
    // (the tooltip opens with "Team preview:" and names the best lead).
    await expect(panel.locator('.ps-eval-graph title:has-text("Team preview:")')).toHaveCount(1, { timeout: 60_000 });

    // Selecting a point switches to that turn's view (played-vs-best).
    await panel.locator('.ps-eval-graph rect[data-turn="1"]').click();
    await expect(panel.locator('.ps-eval-analysis')).toBeVisible();
    await expect(panel.locator('.ps-eval-analysis')).toContainText('Turn 1');
    await expect(panel.locator('.ps-eval-analysis')).toContainText('played');

    // …and the back button returns to the report's cards.
    await panel.locator('button', { hasText: 'Game report' }).click();
    await expect(panel.locator('.ps-eval-report')).toBeVisible();
    await expect(panel.locator('.ps-eval-analysis')).toBeHidden();

    // Selecting the leads point opens the team-preview analysis.
    await panel.locator('.ps-eval-graph rect[data-turn="0"]').click();
    await expect(panel.locator('.ps-eval-analysis')).toContainText('Team preview');
    await expect(panel.locator('.ps-eval-analysis')).toContainText('led');

    // The sweep persisted its results to IndexedDB…
    const storedCount = await page.evaluate(async () => new Promise<number>(resolve => {
      const open = indexedDB.open('ps-replay-interceptor-eval', 1);
      open.onsuccess = () => {
        const countRequest = open.result.transaction('evals').objectStore('evals').count();
        countRequest.onsuccess = () => resolve(countRequest.result);
        countRequest.onerror = () => resolve(-1);
      };
      open.onerror = () => resolve(-1);
    }));
    expect(storedCount).toBeGreaterThan(0);

    // …so after a reload the graph re-analyzes from the store.
    await page.reload();
    await page.locator('button', { hasText: 'Load' }).click();
    await expect(page.getByText('TestPlayer1', { exact: true }).first()).toBeVisible({ timeout: 10000 });
    await panel.locator('button', { hasText: 'Analyze game' }).click();
    await expect(panel.locator('.ps-eval-graph')).toBeVisible({ timeout: 30_000 });
    await expect(panel.locator('button', { hasText: 'Re-analyze' })).toBeVisible({ timeout: 30_000 });
  });

  test('the analysis, lists, and matrix follow the selected turn after a sweep', async ({ page }) => {
    test.setTimeout(240_000);
    await page.evaluate(() => {
      localStorage.setItem('ps-replay-interceptor:eval-pool', '2');
      localStorage.setItem('ps-replay-interceptor:eval-prefs',
        JSON.stringify({ depth: 1, samples: 1, auto: false, tera: 'auto' }));
    });
    await page.reload();
    await page.locator('button', { hasText: 'Load' }).click();
    await expect(page.getByText('TestPlayer1', { exact: true }).first()).toBeVisible({ timeout: 10000 });

    const panel = page.locator('.ps-main-right .ps-eval-panel');
    await panel.locator('button', { hasText: 'Analyze game' }).click();
    await expect(panel.locator('button', { hasText: 'Re-analyze' })).toBeVisible({ timeout: 180_000 });

    // Selecting a turn re-targets EVERYTHING in one place: the analysis,
    // the advantage bar, the ranked lists, and the matrix toggle.
    await panel.locator('.ps-eval-graph rect[data-turn="2"]').click();
    await expect(panel.locator('.ps-eval-analysis')).toContainText('Turn 2', { timeout: 15_000 });
    await expect(panel.locator('.ps-eval-bar')).toBeVisible();
    await expect(panel.locator('button', { hasText: 'Matrix' })).toBeVisible();
    await panel.locator('.ps-eval-graph rect[data-turn="1"]').click();
    await expect(panel.locator('.ps-eval-analysis')).toContainText('Turn 1', { timeout: 15_000 });
  });

  test('deepening is explicit and monotone — clicking an entry never re-searches', async ({ page }) => {
    test.setTimeout(240_000);
    await page.evaluate(() => {
      localStorage.setItem('ps-replay-interceptor:eval-pool', '2');
      localStorage.setItem('ps-replay-interceptor:eval-prefs',
        JSON.stringify({ depth: 1, samples: 1, auto: false, tera: 'auto' }));
    });
    await page.reload();
    await page.locator('button', { hasText: 'Load' }).click();
    await expect(page.getByText('TestPlayer1', { exact: true }).first()).toBeVisible({ timeout: 10000 });

    const panel = page.locator('.ps-main-right .ps-eval-panel');
    await panel.locator('button', { hasText: 'Analyze game' }).click();
    await expect(panel.locator('button', { hasText: 'Re-analyze' })).toBeVisible({ timeout: 180_000 });

    // Selecting a turn shows the stored depth-1 result — no silent
    // re-search swaps the numbers. The escalation is the explicit button
    // (restored 2026-08-13: the single-turn acquire heals like the sweep).
    await panel.locator('.ps-eval-graph rect[data-turn="1"]').click();
    await expect(panel.getByText(/^depth 1/)).toBeVisible({ timeout: 15_000 });
    const deeper = panel.locator('button', { hasText: 'Think deeper about this position' });
    await expect(deeper).toContainText('depth 2');
    await deeper.click();
    await expect(panel.getByText(/^depth 2/)).toBeVisible({ timeout: 120_000 });

    // Monotone merge: a later re-analyze (fast scan) must NOT downgrade the
    // explicitly deepened turn back to depth 1.
    await panel.locator('button', { hasText: 'Re-analyze' }).click();
    await expect(panel.locator('button', { hasText: 'Re-analyze' })).toBeVisible({ timeout: 180_000 });
    await panel.locator('.ps-eval-graph rect[data-turn="1"]').click();
    await expect(panel.getByText(/^depth 2/)).toBeVisible({ timeout: 15_000 });
  });

  test('analyzes the whole game with the MCTS engine', async ({ page }) => {
    test.setTimeout(240_000);
    await page.evaluate(() => {
      localStorage.setItem('ps-replay-interceptor:eval-pool', '2');
      localStorage.setItem('ps-replay-interceptor:eval-prefs',
        JSON.stringify({ depth: 1, samples: 1, mode: 'mcts', auto: false, tera: 'auto' }));
    });
    await page.reload();
    await page.locator('button', { hasText: 'Load' }).click();
    await expect(page.getByText('TestPlayer1', { exact: true }).first()).toBeVisible({ timeout: 10000 });

    const panel = page.locator('.ps-main-right .ps-eval-panel');
    await expect(panel.locator('select').first()).toHaveValue('mcts');
    await panel.locator('button', { hasText: 'Analyze game' }).click();
    await expect(panel.locator('.ps-eval-graph')).toBeVisible({ timeout: 180_000 });
    await expect(panel.locator('button', { hasText: 'Re-analyze' })).toBeVisible({ timeout: 120_000 });

    // The analysis pipeline works on visit-ranked MCTS results too — and
    // the convergence pass brings EVERY turn to the configured engine, not
    // just the report-worthy swings ("I cannot configure anything for the
    // graph line").
    await panel.locator('.ps-eval-graph rect[data-turn="1"]').click();
    await expect(panel.locator('.ps-eval-analysis')).toBeVisible();
    await expect(panel.locator('.ps-eval-analysis')).toContainText('played');
    await expect(panel.getByTitle('What produced the numbers shown for this turn.')).toHaveText('MCTS');
  });

  test('auto mode routes the line per turn: matrix early, MCTS once bodies fall (GPL)', async ({ page }) => {
    test.setTimeout(360_000);
    await page.evaluate(() => {
      localStorage.setItem('ps-replay-interceptor:eval-pool', '2');
      localStorage.setItem('ps-replay-interceptor:eval-prefs',
        JSON.stringify({ depth: 2, samples: 3, mode: 'auto', auto: false, tera: 'auto' }));
    });
    await page.reload();
    // Offline usage payloads: deterministic teams, and the Smogon-loading
    // guard settles so Analyze game is clickable.
    await routeSmogon(page, emptySmogon);
    await page.locator('input[aria-label="Load exported replay file"]')
      .setInputFiles(fixturePath('gpl-replay.html'));

    const panel = page.locator('.ps-main-right .ps-eval-panel');
    // The auto pref round-trips into the dropdown and the caption names the routing.
    await expect(panel.locator('select').first()).toHaveValue('auto');
    await expect(panel.getByText('auto (matrix early, MCTS late)')).toBeVisible();
    await panel.locator('button', { hasText: 'Analyze game' }).click();
    await expect(panel.locator('button', { hasText: 'Re-analyze' })).toBeVisible({ timeout: 300_000 });

    // Turn 2: full boards — the pinned d1s1 matrix side produced the number.
    await panel.locator('.ps-eval-graph rect[data-turn="2"]').click();
    await expect(panel.locator('.ps-eval-analysis')).toContainText('Turn 2', { timeout: 15_000 });
    await expect(panel.getByTitle('What produced the numbers shown for this turn.')).toHaveText('depth 1 · 1 sample');

    // Turn 38: nine bodies down — the DUCT tree took over.
    await panel.locator('.ps-eval-graph rect[data-turn="38"]').click();
    await expect(panel.locator('.ps-eval-analysis')).toContainText('Turn 38', { timeout: 15_000 });
    await expect(panel.getByTitle('What produced the numbers shown for this turn.')).toHaveText('MCTS');
    // Round 32: a tree turn offers no matrix rung (it would see three plies
    // where the tree saw seven); the badge stays MCTS and no ladder button
    // renders for this turn.
    await expect(panel.locator('button', { hasText: 'Think deeper about this position' })).toHaveCount(0);
    await expect(panel.getByTitle('What produced the numbers shown for this turn.')).toHaveText('MCTS');
  });
});
