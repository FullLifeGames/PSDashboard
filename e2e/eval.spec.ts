import { test, expect } from '@playwright/test';
import { installReplayEmbedCache, routeOfflineFixtures, startVariationAt } from './helpers';

test.beforeAll(installReplayEmbedCache);

test.describe('PS Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await routeOfflineFixtures(page);
    await page.goto('/');
  });

  test('evaluates a replay position from the replay view', async ({ page }) => {
    test.setTimeout(180_000);
    // Depth 1 / 1 sample and a 2-worker pool keep the search light under
    // full-suite CPU load (many parallel pages each spawn an eval pool);
    // depth-2 behavior is covered deterministically by the regression suite.
    await page.evaluate(() => {
      localStorage.setItem('ps-replay-interceptor:eval-pool', '2');
      localStorage.setItem('ps-replay-interceptor:eval-prefs',
        JSON.stringify({ depth: 1, samples: 1, auto: false, tera: 'auto' }));
    });
    await page.reload();
    await page.locator('button', { hasText: 'Load' }).click();
    await expect(page.getByText('TestPlayer1', { exact: true }).first()).toBeVisible({ timeout: 10000 });

    // The panel lives beside the battle in the right column (chess-style).
    const panel = page.locator('.ps-main-right .ps-eval-panel');
    await expect(panel).toBeVisible();
    // ONE entry point: the sweep analyzes the game, lands on the report
    // overview; clicking a turn opens that turn's full view.
    await panel.locator('button', { hasText: 'Analyze game' }).click();
    await expect(panel.locator('button', { hasText: 'Re-analyze' })).toBeVisible({ timeout: 120_000 });

    // The feedback drift harness reads the analysis through this handle —
    // pin its shape where an analyze-game run already exists.
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
    // The eval-error trail is present and clean on the healthy fixture.
    expect(debugShape!.evalErrorSlots).toBeGreaterThan(0);
    expect(debugShape!.evalErrorCount).toBe(0);
    expect(debugShape!.analyses).not.toBeNull();
    expect(debugShape!.hasReport).toBe(true);

    // Turn 0 rides along in singles too: the sweep's last act evaluates the
    // team-preview decision, and the graph's T0 diamond names the best lead.
    const t0Hit = panel.locator('.ps-eval-graph rect[data-turn="0"]');
    await expect(t0Hit).toBeVisible({ timeout: 30_000 });
    await expect(t0Hit.locator('title')).toContainText('best lead');

    await panel.locator('.ps-eval-graph rect[data-turn="1"]').click();
    await expect(panel.locator('.ps-eval-bar')).toBeVisible({ timeout: 120_000 });
    await expect(panel.locator('.ps-eval-bar-p1')).toContainText('%');
    expect(await panel.locator('.ps-eval-column').count()).toBe(2);
    // Ranked choices speak the bar's percent language; the floor and the
    // punishing reply live in the tooltip.
    await expect(panel.locator('.ps-eval-choice-main').first()).toContainText(/\d+%/);
    await expect(panel.locator('.ps-eval-choice').first()).toHaveAttribute('title', /guaranteed at least/);

    // The solved matrix behind the rankings opens on demand: every pair at
    // its win probability, equilibrium mixes on the headers.
    await panel.locator('button', { hasText: 'Matrix' }).click();
    const matrix = panel.locator('table');
    await expect(matrix).toBeVisible();
    await expect(matrix.locator('td').first()).toContainText(/\d+%/);
    await panel.locator('button', { hasText: 'Hide matrix' }).click();
    await expect(matrix).toBeHidden();
  });

  test('clicking an engine choice from the replay view branches with it prefilled', async ({ page }) => {
    test.setTimeout(240_000);
    await page.evaluate(() => {
      localStorage.setItem('ps-replay-interceptor:eval-pool', '2');
      localStorage.setItem('ps-replay-interceptor:eval-prefs', JSON.stringify({ depth: 1, samples: 1, auto: false, tera: 'auto' }));
    });
    await page.reload();
    await page.locator('button', { hasText: 'Load' }).click();
    await expect(page.getByText('TestPlayer1', { exact: true }).first()).toBeVisible({ timeout: 10000 });

    const panel = page.locator('.ps-main-right .ps-eval-panel');
    await panel.locator('button', { hasText: 'Analyze game' }).click();
    await expect(panel.locator('button', { hasText: 'Re-analyze' })).toBeVisible({ timeout: 120_000 });
    await panel.locator('.ps-eval-graph rect[data-turn="1"]').click();
    await expect(panel.locator('.ps-eval-bar')).toBeVisible({ timeout: 120_000 });

    // Clicking p1's top engine line enters a branch and PLAYS THE TURN OUT
    // against the engine's reply…
    await panel.locator('.ps-eval-column').first().locator('button.ps-eval-choice').first().click();
    await expect(page.getByText(/Branching · Turn/)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/Branching · Turn 2/)).toBeVisible({ timeout: 60_000 });

    // …auto re-evaluation surfaces the next recommendations for the walk
    // (the click also arms Auto for the turns that follow).
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
    await page.locator('button', { hasText: 'Load' }).click();
    await expect(page.getByText('TestPlayer1', { exact: true }).first()).toBeVisible({ timeout: 10000 });

    const panel = page.locator('.ps-main-right .ps-eval-panel');
    await panel.locator('button', { hasText: 'Analyze game' }).click();
    await expect(panel.locator('button', { hasText: 'Re-analyze' })).toBeVisible({ timeout: 120_000 });
    await panel.locator('.ps-eval-graph rect[data-turn="1"]').click();
    await expect(panel.locator('.ps-eval-bar')).toBeVisible({ timeout: 120_000 });

    // A cell names BOTH sides' choices — the branch executes exactly that
    // pair (not the engine's preferred reply).
    await panel.locator('button', { hasText: 'Matrix' }).click();
    await panel.locator('table td button').first().click();
    await expect(page.getByText(/Branching · Turn/)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/Branching · Turn 2/)).toBeVisible({ timeout: 60_000 });
  });

  test('evaluates a position with the MCTS mode', async ({ page }) => {
    test.setTimeout(180_000);
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
    await page.locator('button', { hasText: 'Load' }).click();
    // Unified timeline: playing a move puts the live sim at the tip — the
    // Evaluate button and choice clicks work from there.
    await startVariationAt(page, 1);
    await expect(page.getByText(/Branching · Turn 2/)).toBeVisible({ timeout: 60_000 });

    const panel = page.locator('.ps-eval-panel');
    await panel.locator('button', { hasText: /^Evaluate$|^Re-evaluate$/ }).click();
    await expect(panel.locator('.ps-eval-bar')).toBeVisible({ timeout: 120_000 });

    // One click commits the line, answers with the engine's reply, and
    // executes — the walk continues from the next position.
    await panel.locator('.ps-eval-column').nth(0).locator('.ps-eval-choice').first().click();
    await expect(page.getByText(/Branching · Turn 3/)).toBeVisible({ timeout: 60_000 });
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
    await page.locator('button', { hasText: 'Load' }).click();
    await expect(page.getByText('Alice', { exact: true }).first()).toBeVisible({ timeout: 10000 });

    const panel = page.locator('.ps-main-right .ps-eval-panel');
    await expect(panel).toBeVisible();
    // One entry point: the sweep analyzes the game; clicking the turn opens
    // its full view with the bar and combined choices.
    await panel.locator('button', { hasText: 'Analyze game' }).click();
    await expect(panel.locator('button', { hasText: 'Re-analyze' })).toBeVisible({ timeout: 120_000 });
    await panel.locator('.ps-eval-graph rect[data-turn="1"]').click();
    await expect(panel.locator('.ps-eval-bar')).toBeVisible({ timeout: 120_000 });
    await expect(panel.locator('.ps-eval-bar-p1')).toContainText('%');
    // Recommendations are combined two-slot choices ("A + B").
    await expect(panel.locator('.ps-eval-choice').first()).toContainText('+');

    // The chat-posted team sheet surfaces in the stats panel as SHEET data.
    await expect(page.locator('.ps-stats-tag', { hasText: 'Light Ball' })).toBeVisible();
    await expect(page.locator('.ps-stats-tag', { hasText: 'Light Ball' })).toContainText('sheet');

    // Doubles turn analysis — automatic. The fixture's only turn is the
    // FINAL turn (its played actions have no trailing block to parse from),
    // so the honest copy says the choice never surfaced while the engine's
    // combined lines still render.
    await expect(panel.locator('.ps-eval-analysis')).toBeVisible({ timeout: 120_000 });
    await expect(panel.locator('.ps-eval-analysis-summary')).toContainText('%');
    await expect(panel.locator('.ps-eval-analysis')).toContainText('engine:');

    // Long combined labels must wrap inside the panel, never widen it.
    const overflow = await panel.evaluate(element => element.scrollWidth - element.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
