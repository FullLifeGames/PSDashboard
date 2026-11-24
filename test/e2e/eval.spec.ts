import { test, expect } from '@playwright/test';
import { installReplayEmbedCache, readDepth, routeOfflineFixtures, startVariationAt } from './helpers';

test.beforeAll(installReplayEmbedCache);

test.describe('PS Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await routeOfflineFixtures(page);
    await page.goto('/');
  });

  test('evaluates a replay position from the replay view', async ({ page }) => {
    test.setTimeout(180_000);
    await page.evaluate(() => {
      localStorage.setItem('ps-replay-interceptor:eval-pool', '2');
      localStorage.setItem('ps-replay-interceptor:eval-prefs',
        JSON.stringify({ depth: 1, samples: 1, auto: false, tera: 'auto' }));
    });
    await page.reload();
    await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
    await expect(page.getByText('TestPlayer1', { exact: true }).first()).toBeVisible({ timeout: 10000 });

    const panel = page.locator('.ps-main-right .ps-eval-panel');
    await expect(panel).toBeVisible();
    await panel.locator('button', { hasText: 'Analyze game' }).click();
    await expect(panel.locator('button', { hasText: 'Re-analyze' })).toBeVisible({ timeout: 120_000 });

    // The feedback drift harness reads the analysis through this handle.
    const debugShape = await page.evaluate(() => {
      const dbg = (window as unknown as {
        __psDebug?: { graph: { running: boolean; scores: unknown[]; evalErrors: unknown[] }; analyses: unknown[] | null; gameReport: unknown };
      }).__psDebug;
      return dbg ? {
        running: dbg.graph.running,
        sweptScores: dbg.graph.scores.filter(score => score !== null).length,
        evalErrorSlots: dbg.graph.evalErrors.length,
        evalErrorCount: dbg.graph.evalErrors.filter(message => message !== null).length,
        analyses: dbg.analyses?.length ?? null,
        hasReport: dbg.gameReport !== null,
      } : null;
    });
    expect(debugShape).not.toBeNull();
    expect(debugShape!.running).toBe(false);
    expect(debugShape!.sweptScores).toBeGreaterThan(0);
    expect(debugShape!.evalErrorSlots).toBeGreaterThan(0);
    expect(debugShape!.evalErrorCount).toBe(0);
    expect(debugShape!.analyses).not.toBeNull();
    expect(debugShape!.hasReport).toBe(true);

    const t0Hit = panel.locator('.ps-eval-graph rect[data-turn="0"]');
    await expect(t0Hit).toBeVisible({ timeout: 30_000 });
    await expect(t0Hit.locator('title')).toContainText('best lead');

    await panel.locator('.ps-eval-graph rect[data-turn="1"]').click();
    await expect(panel.locator('.ps-eval-bar')).toBeVisible({ timeout: 120_000 });
    await expect(panel.locator('.ps-eval-bar-p1')).toContainText('%');
    expect(await panel.locator('.ps-eval-column').count()).toBe(2);
    await expect(panel.locator('.ps-eval-choice-main').first()).toContainText(/\d+%/);
    await expect(panel.locator('.ps-eval-choice').first()).toHaveAttribute('title', /guaranteed at least/);

    await panel.locator('button.ps-eval-matrix-toggle').click();
    const matrix = panel.locator('table');
    await expect(matrix).toBeVisible();
    await expect(matrix.locator('td').first()).toContainText(/\d+%/);
    await panel.locator('button.ps-eval-matrix-toggle').click();
    await expect(matrix).toBeHidden();
  });

  test('clicking an engine choice from the replay view branches with it prefilled', async ({ page }) => {
    test.setTimeout(240_000);
    await page.evaluate(() => {
      localStorage.setItem('ps-replay-interceptor:eval-pool', '2');
      localStorage.setItem('ps-replay-interceptor:eval-prefs', JSON.stringify({ depth: 1, samples: 1, auto: false, tera: 'auto' }));
    });
    await page.reload();
    await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
    await expect(page.getByText('TestPlayer1', { exact: true }).first()).toBeVisible({ timeout: 10000 });

    const panel = page.locator('.ps-main-right .ps-eval-panel');
    await panel.locator('button', { hasText: 'Analyze game' }).click();
    await expect(panel.locator('button', { hasText: 'Re-analyze' })).toBeVisible({ timeout: 120_000 });
    await panel.locator('.ps-eval-graph rect[data-turn="1"]').click();
    await expect(panel.locator('.ps-eval-bar')).toBeVisible({ timeout: 120_000 });

    await panel.locator('.ps-eval-column').first().locator('button.ps-eval-choice').first().click();
    await expect(page.getByText(/Variation tip: Turn/)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/Variation tip: Turn 2/)).toBeVisible({ timeout: 60_000 });

    await expect(panel.locator('.ps-eval-bar')).toBeVisible({ timeout: 120_000 });
    await expect(panel.locator('.ps-eval-column').first().locator('button.ps-eval-choice').first())
      .toBeVisible({ timeout: 120_000 });
    await expect(panel.getByRole('checkbox', { name: 'Auto' })).toBeChecked();
  });

  test('clicking a matrix cell branches with exactly that pair', async ({ page }) => {
    test.setTimeout(240_000);
    await page.evaluate(() => {
      localStorage.setItem('ps-replay-interceptor:eval-pool', '2');
      localStorage.setItem('ps-replay-interceptor:eval-prefs', JSON.stringify({ depth: 1, samples: 1, auto: false, tera: 'auto' }));
    });
    await page.reload();
    await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
    await expect(page.getByText('TestPlayer1', { exact: true }).first()).toBeVisible({ timeout: 10000 });

    const panel = page.locator('.ps-main-right .ps-eval-panel');
    await panel.locator('button', { hasText: 'Analyze game' }).click();
    await expect(panel.locator('button', { hasText: 'Re-analyze' })).toBeVisible({ timeout: 120_000 });
    await panel.locator('.ps-eval-graph rect[data-turn="1"]').click();
    await expect(panel.locator('.ps-eval-bar')).toBeVisible({ timeout: 120_000 });

    await panel.locator('button.ps-eval-matrix-toggle').click();
    await panel.locator('table td button').first().click();
    await expect(page.getByText(/Variation tip: Turn/)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/Variation tip: Turn 2/)).toBeVisible({ timeout: 60_000 });
  });

  test('evaluates a position with the MCTS mode', async ({ page }) => {
    test.setTimeout(180_000);
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
    await expect(panel.locator('button', { hasText: 'Re-analyze' })).toBeVisible({ timeout: 120_000 });
    await panel.locator('.ps-eval-graph rect[data-turn="1"]').click();
    await expect(panel.locator('.ps-eval-bar')).toBeVisible({ timeout: 120_000 });
    await expect(panel.locator('.ps-eval-bar-p1')).toContainText('%');
  });

  test('branch mode: clicking a recommendation plays the turn out', async ({ page }) => {
    test.setTimeout(180_000);
    await page.evaluate(() => {
      localStorage.setItem('ps-replay-interceptor:eval-pool', '2');
      localStorage.setItem('ps-replay-interceptor:eval-prefs',
        JSON.stringify({ depth: 1, samples: 1, auto: false, tera: 'auto' }));
    });
    await page.reload();
    await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
    await startVariationAt(page, 1);
    await expect(page.getByText(/Variation tip: Turn 2/)).toBeVisible({ timeout: 60_000 });

    const panel = page.locator('.ps-eval-panel');
    await panel.locator('button', { hasText: /^Evaluate$|^Re-evaluate$/ }).click();
    await expect(panel.locator('.ps-eval-bar')).toBeVisible({ timeout: 120_000 });

    await panel.locator('.ps-eval-column').nth(0).locator('.ps-eval-choice').first().click();
    await expect(page.getByText(/Variation tip: Turn 3/)).toBeVisible({ timeout: 60_000 });
  });

  test('evaluates a doubles replay position with combined choices', async ({ page }) => {
    test.setTimeout(180_000);
    await page.evaluate(() => {
      localStorage.setItem('ps-replay-interceptor:eval-pool', '2');
      localStorage.setItem('ps-replay-interceptor:eval-prefs',
        JSON.stringify({ depth: 1, samples: 1, auto: false, tera: 'auto' }));
    });
    await page.reload();
    await page.locator('input[type="text"]').fill('gen9doubles-test');
    await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
    await expect(page.getByText('Alice', { exact: true }).first()).toBeVisible({ timeout: 10000 });

    const panel = page.locator('.ps-main-right .ps-eval-panel');
    await expect(panel).toBeVisible();
    await panel.locator('button', { hasText: 'Analyze game' }).click();
    await expect(panel.locator('button', { hasText: 'Re-analyze' })).toBeVisible({ timeout: 120_000 });
    await panel.locator('.ps-eval-graph rect[data-turn="1"]').click();
    await expect(panel.locator('.ps-eval-bar')).toBeVisible({ timeout: 120_000 });
    await expect(panel.locator('.ps-eval-bar-p1')).toContainText('%');
    await expect(panel.locator('.ps-eval-choice').first()).toContainText('+');

    await expect(page.locator('.ps-stats-tag', { hasText: 'Light Ball' })).toBeVisible();
    await expect(page.locator('.ps-stats-tag', { hasText: 'Light Ball' })).toContainText('sheet');

    // The fixture's only turn is the final one: its played actions have no trailing block to parse.
    await expect(panel.locator('.ps-eval-analysis')).toBeVisible({ timeout: 120_000 });
    const summary = panel.locator('.ps-eval-analysis .ps-eval-analysis-summary');
    await expect(summary).toBeHidden();
    await panel.locator('.ps-eval-analysis').getByRole('button', { name: 'Explanation' }).click();
    await expect(summary).toBeVisible();
    await expect(summary).toContainText('%');
    await expect(panel.locator('.ps-eval-analysis')).toContainText('engine:');

    const overflow = await panel.evaluate(element => element.scrollWidth - element.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
