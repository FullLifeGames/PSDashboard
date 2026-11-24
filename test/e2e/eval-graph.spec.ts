import { test, expect, type Page } from '@playwright/test';
import { emptySmogon, routeSmogon } from './smogon-routes';
import { fixturePath, installReplayEmbedCache, pickDepth, readDepth, routeOfflineFixtures } from './helpers';

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
    await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
    await expect(page.getByText('TestPlayer1', { exact: true }).first()).toBeVisible({ timeout: 10000 });

    const panel = page.locator('.ps-main-right .ps-eval-panel');
    await panel.locator('button', { hasText: 'Analyze game' }).click();
    await expect(panel.locator('.ps-eval-graph')).toBeVisible({ timeout: 180_000 });
    expect(await panel.locator('.ps-eval-graph circle').count()).toBeGreaterThan(0);
    await expect(panel.locator('button', { hasText: 'Re-analyze' })).toBeVisible({ timeout: 60_000 });

    const perf = await page.evaluate(() => (window as unknown as { __EVAL_PERF__?: { stages: Record<string, { count: number }> } }).__EVAL_PERF__);
    expect(perf?.stages['cache-load']?.count).toBe(1);

    await expect(panel.locator('.ps-eval-report')).toBeVisible();
    await expect(panel.locator('.ps-eval-report')).toContainText('Game report');

    await expect(panel.locator('.ps-eval-graph title:has-text("Team preview:")')).toHaveCount(1, { timeout: 60_000 });

    await panel.locator('.ps-eval-graph rect[data-turn="1"]').click();
    await expect(panel.locator('.ps-eval-analysis')).toBeVisible();
    await expect(panel.locator('.ps-eval-analysis')).toContainText('Turn 1');
    await expect(panel.locator('.ps-eval-analysis')).toContainText('played');

    await panel.locator('button', { hasText: 'Game report' }).click();
    await expect(panel.locator('.ps-eval-report')).toBeVisible();
    await expect(panel.locator('.ps-eval-analysis')).toBeHidden();

    await panel.locator('.ps-eval-graph rect[data-turn="0"]').click();
    await expect(panel.locator('.ps-eval-analysis')).toContainText('Team preview');
    await expect(panel.locator('.ps-eval-analysis')).toContainText('led');

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

    await page.reload();
    await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
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
    await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
    await expect(page.getByText('TestPlayer1', { exact: true }).first()).toBeVisible({ timeout: 10000 });

    const panel = page.locator('.ps-main-right .ps-eval-panel');
    await panel.locator('button', { hasText: 'Analyze game' }).click();
    await expect(panel.locator('button', { hasText: 'Re-analyze' })).toBeVisible({ timeout: 180_000 });

    await panel.locator('.ps-eval-graph rect[data-turn="2"]').click();
    await expect(panel.locator('.ps-eval-analysis')).toContainText('Turn 2', { timeout: 15_000 });
    await expect(panel.locator('.ps-eval-bar')).toBeVisible();
    await expect(panel.locator('button.ps-eval-matrix-toggle')).toBeVisible();
    await panel.locator('.ps-eval-graph rect[data-turn="1"]').click();
    await expect(panel.locator('.ps-eval-analysis')).toContainText('Turn 1', { timeout: 15_000 });
  });

  test('clicking an entry never re-searches, and a shallower re-analyze never downgrades a deeper turn', async ({ page }) => {
    test.setTimeout(240_000);
    await page.evaluate(() => {
      localStorage.setItem('ps-replay-interceptor:eval-pool', '2');
      localStorage.setItem('ps-replay-interceptor:eval-prefs',
        JSON.stringify({ depth: 2, samples: 1, auto: false, tera: 'auto' }));
    });
    await page.reload();
    await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
    await expect(page.getByText('TestPlayer1', { exact: true }).first()).toBeVisible({ timeout: 10000 });

    const panel = page.locator('.ps-main-right .ps-eval-panel');
    await panel.locator('button', { hasText: 'Analyze game' }).click();
    await expect(panel.locator('button', { hasText: 'Re-analyze' })).toBeVisible({ timeout: 180_000 });

    await panel.locator('.ps-eval-graph rect[data-turn="1"]').click();
    await expect(panel.getByText(/^depth 2/)).toBeVisible({ timeout: 15_000 });
    await expect(panel.locator('button', { hasText: 'Think deeper' })).toHaveCount(0);

    await pickDepth(page, '1');
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
    await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
    await expect(page.getByText('TestPlayer1', { exact: true }).first()).toBeVisible({ timeout: 10000 });

    const panel = page.locator('.ps-main-right .ps-eval-panel');
    expect(await readDepth(page)).toBe('mcts');
    await panel.locator('button', { hasText: 'Analyze game' }).click();
    await expect(panel.locator('.ps-eval-graph')).toBeVisible({ timeout: 180_000 });
    await expect(panel.locator('button', { hasText: 'Re-analyze' })).toBeVisible({ timeout: 120_000 });

    await panel.locator('.ps-eval-graph rect[data-turn="1"]').click();
    await expect(panel.locator('.ps-eval-analysis')).toBeVisible();
    await expect(panel.locator('.ps-eval-analysis')).toContainText('played');
    await expect(panel.getByTitle('What produced the numbers shown for this turn.')).toHaveText('MCTS');
  });

  test('auto mode runs early singles turns on the matrix and the tree once bodies fell (GPL)', async ({ page }) => {
    test.setTimeout(360_000);
    await page.evaluate(() => {
      localStorage.setItem('ps-replay-interceptor:eval-pool', '2');
      localStorage.setItem('ps-replay-interceptor:eval-prefs',
        JSON.stringify({ depth: 2, samples: 3, mode: 'auto', auto: false, tera: 'auto' }));
    });
    await page.reload();
    await routeSmogon(page, emptySmogon);
    await page.locator('input[aria-label="Load exported replay file"]')
      .setInputFiles(fixturePath('gpl-replay.html'));

    const panel = page.locator('.ps-main-right .ps-eval-panel');
    expect(await readDepth(page)).toBe('auto');
    await expect(panel.getByText('Game graph', { exact: true })).toHaveAttribute('title', /re-evaluates each turn with auto \(matrix early, MCTS late\)/);
    await panel.locator('button', { hasText: 'Analyze game' }).click();
    await expect(panel.locator('button', { hasText: 'Re-analyze' })).toBeVisible({ timeout: 300_000 });

    // Singles prices full boards with the matrix until a quarter of all bodies fell; doubles run the tree at once.
    await panel.locator('.ps-eval-graph rect[data-turn="2"]').click();
    await expect(panel.locator('.ps-eval-analysis')).toContainText('Turn 2', { timeout: 15_000 });
    await expect(panel.getByTitle('What produced the numbers shown for this turn.')).toHaveText('depth 1 · 3 samples');

    await panel.locator('.ps-eval-graph rect[data-turn="38"]').click();
    await expect(panel.locator('.ps-eval-analysis')).toContainText('Turn 38', { timeout: 15_000 });
    await expect(panel.getByTitle('What produced the numbers shown for this turn.')).toHaveText('MCTS');
    await expect(panel.locator('button', { hasText: 'Think deeper' })).toHaveCount(0);
  });
  const STAGE_BADGE = 'What produced the numbers shown for this turn.';

  async function expectReanalyzeReplaces(page: Page, mode: 'mcts' | 'auto') {
    const panel = page.locator('.ps-main-right .ps-eval-panel');
    await panel.locator('button', { hasText: 'Analyze game' }).click();
    await expect(panel.locator('button', { hasText: 'Re-analyze' })).toBeVisible({ timeout: 240_000 });
    await panel.locator('.ps-eval-graph rect[data-turn="1"]').click();
    await expect(panel.getByTitle(STAGE_BADGE)).toHaveText(/^depth 2/, { timeout: 15_000 });

    await pickDepth(page, mode);
    await panel.locator('button', { hasText: 'Re-analyze' }).click();
    // The click may land on a stale panel: keep opening turn 1 until the sweep has swapped its result.
    await expect(async () => {
      await panel.locator('.ps-eval-graph rect[data-turn="1"]').click();
      await expect(panel.getByTitle(STAGE_BADGE)).toHaveText('MCTS', { timeout: 3_000 });
    }).toPass({ timeout: 240_000 });
  }

  test('after depth 2 and Auto, Re-analyze replaces the stored result on every doubles turn (VGC)', async ({ page }) => {
    test.setTimeout(420_000);
    await page.evaluate(() => {
      localStorage.setItem('ps-replay-interceptor:eval-pool', '2');
      localStorage.setItem('ps-replay-interceptor:eval-prefs',
        JSON.stringify({ depth: 2, samples: 1, mode: 'matrix', auto: false, tera: 'auto' }));
    });
    await page.reload();
    await page.locator('input[type="text"]').fill('gen9vgc-test');
    await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
    await expect(page.getByText('Alice', { exact: true }).first()).toBeVisible({ timeout: 10000 });
    await expectReanalyzeReplaces(page, 'auto');
  });

  test('after depth 2 and the MCTS engine, Re-analyze replaces the stored result in singles', async ({ page }) => {
    test.setTimeout(420_000);
    await page.evaluate(() => {
      localStorage.setItem('ps-replay-interceptor:eval-pool', '2');
      localStorage.setItem('ps-replay-interceptor:eval-prefs',
        JSON.stringify({ depth: 2, samples: 1, mode: 'matrix', auto: false, tera: 'auto' }));
    });
    await page.reload();
    await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
    await expect(page.getByText('TestPlayer1', { exact: true }).first()).toBeVisible({ timeout: 10000 });
    await expectReanalyzeReplaces(page, 'mcts');
  });

  // The 1-turn doubles fixture has no earlier turn to step to.
  for (const { kind, replayId, player } of [
    { kind: 'singles', replayId: null, player: 'TestPlayer1' },
    { kind: 'doubles (VGC)', replayId: 'gen9vgc-test', player: 'Alice' },
  ]) {
    test(`Analyze this position on a gap turn searches it and fills the analysis (${kind})`, async ({ page }) => {
      test.setTimeout(300_000);
      await page.evaluate(() => {
        localStorage.setItem('ps-replay-interceptor:eval-pool', '2');
        localStorage.setItem('ps-replay-interceptor:eval-prefs',
          JSON.stringify({ depth: 1, samples: 1, mode: 'matrix', auto: false, tera: 'auto' }));
      });
      await page.reload();
      if (replayId) await page.locator('input[type="text"]').fill(replayId);
      await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
      await expect(page.getByText(player, { exact: true }).first()).toBeVisible({ timeout: 10000 });

      const slider = page.locator('input[type="range"]');
      await expect(slider).toBeVisible({ timeout: 10000 });
      await slider.fill('2');
      await expect(page.getByText(/T2\/\d+/)).toBeVisible();

      const panel = page.locator('.ps-main-right .ps-eval-panel');
      const analyze = panel.getByRole('button', { name: 'Analyze this position (depth 1)' });
      await expect(analyze).toBeEnabled({ timeout: 30_000 });
      await expect(panel.locator('.ps-eval-analysis')).toHaveCount(0);
      await analyze.click();

      await expect(panel.locator('.ps-eval-analysis')).toContainText('Turn 2', { timeout: 240_000 });
      await expect(panel.getByTitle(STAGE_BADGE)).toHaveText(/^depth 1/, { timeout: 30_000 });
      await expect(analyze).toHaveCount(0);
    });
  }

});
