import { test, expect } from '@playwright/test';
import { expectReplayTurn, installReplayEmbedCache, routeOfflineFixtures, startVariationAt, type ReplayWindow } from './helpers';

test.beforeAll(installReplayEmbedCache);

test.describe('PS Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await routeOfflineFixtures(page);
    await page.goto('/');
  });

  test('shows the always-visible timeline bar with slider', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    await expect(page.locator('input[type="range"]')).toBeVisible({ timeout: 10000 });
    // "Branch Here" is gone as a concept — the pickers are always live.
    await expect(page.locator('button', { hasText: 'Branch Here' })).toHaveCount(0);
    await expect(page.getByText('Timeline')).toBeVisible();
  });

  test('branch turn slider updates turn display', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    const slider = page.locator('input[type="range"]');
    await expect(slider).toBeVisible({ timeout: 10000 });
    await expect(slider).toHaveAttribute('min', '1');
    await slider.fill('2');
    await expect(page.getByText('T2/')).toBeVisible();
  });

  test('branch turn slider seeks without rebuilding the replay iframe', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    const iframe = page.locator('iframe[title="PS Replay"]');
    await expect(iframe).toBeVisible({ timeout: 10000 });
    const initialSrc = await iframe.getAttribute('src');

    await page.locator('input[type="range"]').fill('2');
    await expect(iframe).toHaveAttribute('src', initialSrc || '');
  });

  test('branch turn slider moves the replay viewer to the selected turn', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    const iframeHandle = await page.locator('iframe[title="PS Replay"]').elementHandle({ timeout: 10000 });
    const frame = await iframeHandle?.contentFrame();
    expect(frame).toBeTruthy();

    await page.locator('input[type="range"]').fill('2');
    await expectReplayTurn(frame!, 2);
  });

  test('a long forward slider jump lands the scene instead of hanging on "seeking..."', async ({ page }) => {
    test.setTimeout(150_000);
    // A long, chatty log makes the embed fast-forward in >300ms chunks — the
    // chained continuation that scene.pause()'s interruptionCount bump used
    // to cancel (the old post-seek pause(): a permanent "seeking..." hang).
    // Every log line is a DOM write while seeking, so line count is the load.
    // Self-consistent synthetic replay: appending turns to a real fixture
    // would reference mons its log never introduced and error the parser.
    const seekReplay = {
      id: 'gen9ou-seektest',
      format: '[Gen 9] OU',
      formatid: 'gen9ou',
      players: ['Seeker', 'Sitter'],
      uploadtime: 0,
      views: 0,
      log: [
        '|player|p1|Seeker|',
        '|player|p2|Sitter|',
        '|gametype|singles',
        '|gen|9',
        '|tier|[Gen 9] OU',
        '|clearpoke',
        '|poke|p1|Pikachu, L50|',
        '|poke|p2|Squirtle, L50|',
        '|teampreview',
        '|start',
        '|switch|p1a: Pikachu|Pikachu, L50|100/100',
        '|switch|p2a: Squirtle|Squirtle, L50|100/100',
        '|turn|1',
        ...Array.from({ length: 799 }, (_, i) => [
          '|move|p1a: Pikachu|Quick Attack|p2a: Squirtle',
          '|-damage|p2a: Squirtle|100/100',
          '|move|p2a: Squirtle|Water Gun|p1a: Pikachu',
          '|-damage|p1a: Pikachu|100/100',
          '|upkeep',
          `|turn|${i + 2}`,
        ].join('\n')),
      ].join('\n'),
    };
    await page.route('**/replay.pokemonshowdown.com/**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(seekReplay),
      });
    });
    await page.locator('button', { hasText: 'Load' }).click();
    const iframeHandle = await page.locator('iframe[title="PS Replay"]').elementHandle({ timeout: 10000 });
    const frame = await iframeHandle?.contentFrame();
    expect(frame).toBeTruthy();
    await expect.poll(async () => frame!.evaluate(() =>
      !!(window as ReplayWindow).Replays?.battle
    ), { timeout: 30_000 }).toBe(true);

    // Throttle the CPU so the fast-forward genuinely crosses the 300ms chunk
    // boundary — on a fast machine the whole seek finishes synchronously and
    // the regression (a cancelled continuation) could never fire. The hang
    // shows as a turn counter frozen forever; slow-but-alive seeking still
    // arrives, so the generous poll separates the two.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    try {
      await page.locator('input[type="range"]').fill('400');
      await expect.poll(async () => frame!.evaluate(() =>
        (window as ReplayWindow).Replays?.battle?.turn ?? -1
      ), { timeout: 90_000 }).toBe(400);
      // The seek must have ENDED — a stuck battle.seeking is the hang.
      await expect.poll(async () => frame!.evaluate(() =>
        (window as ReplayWindow).Replays?.battle?.seeking ?? null
      ), { timeout: 15_000 }).toBeNull();
    } finally {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    }
  });

  test('replay iframe keeps a fixed visible height without negative offset', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    const iframe = page.locator('iframe[title="PS Replay"]');
    await expect(iframe).toBeVisible({ timeout: 10000 });
    await expect(iframe).toHaveCSS('height', '480px');
    await expect(iframe).toHaveCSS('margin-top', '0px');
  });

  test('branch replay iframe keeps the same fixed visible height', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    await startVariationAt(page, 1);

    const branchIframe = page.locator('iframe[title="Branch Simulation"]');
    await expect(branchIframe).toBeVisible({ timeout: 10000 });
    await expect(branchIframe).toHaveCSS('height', '480px');
    await expect(branchIframe).toHaveCSS('margin-top', '0px');
    await expect(page.locator('iframe')).toHaveCount(1);
  });

  test('a move executed at the selected slider turn opens the variation there', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    await startVariationAt(page, 2);

    // The executed turn is entry "Turn 2"; the sim continues one past it.
    await expect(page.locator('.ps-panel', { hasText: 'Variation moves' })).toContainText('Turn 2');
    await expect(page.getByText(/Branching · Turn/)).toBeVisible({ timeout: 15000 });
  });

  test.describe('unified timeline', () => {
    test('navigate back inside the variation and silently truncate on a new move', async ({ page }) => {
      test.setTimeout(120_000);
      await page.locator('button', { hasText: 'Load' }).click();
      // Two turns of variation: Swords Dance keeps turn 1 KO-free.
      await startVariationAt(page, 1, { p1Move: 'Swords Dance' });
      const p1 = page.locator('.ps-branch-side-column').first();
      const p2 = page.locator('.ps-branch-side-column').nth(1);
      await p1.locator('.ps-movebtn:enabled').first().click();
      await p2.locator('.ps-movebtn:enabled').first().click();
      await page.locator('.ps-execute-btn').click();
      await expect(page.locator('.ps-panel', { hasText: 'Variation moves' })).toContainText('Turn 2', { timeout: 60_000 });

      // Step back one position: the pointer sits INSIDE the variation, the
      // pickers come from the recorded position, and the line chip appears.
      await page.locator('.ps-branch-bar button', { hasText: '◀' }).click();
      await expect(page.getByText('Choices from the reconstructed position')).toBeVisible();
      await expect(page.locator('.ps-line-chip')).toBeVisible();

      // Deviate here: a DIFFERENT P1 move — NO confirm may appear (chess
      // rules: truncation inside the variation is silent).
      await p1.locator('.ps-movebtn:enabled').nth(1).click();
      await p2.locator('.ps-movebtn:enabled').first().click();
      await page.locator('.ps-execute-btn').click();
      await expect(page.locator('[role="alertdialog"]')).toHaveCount(0);
      await expect(page.locator('.ps-panel', { hasText: 'Variation moves' })).toContainText('Turn 2', { timeout: 60_000 });
    });

    test('main line stays one click away and replacing from it asks first', async ({ page }) => {
      test.setTimeout(120_000);
      await page.locator('button', { hasText: 'Load' }).click();
      await startVariationAt(page, 2);

      // One click back to the main line — view only, nothing destroyed.
      await page.locator('.ps-line-chip button', { hasText: 'Main line' }).click();
      await expect(page.locator('iframe[title="PS Replay"]')).toBeVisible({ timeout: 10000 });
      await expect(page.locator('.ps-panel', { hasText: 'Variation moves' })).toContainText('Turn 2');

      // Deviating ON the main line asks first; Cancel keeps the variation.
      await page.locator('.ps-branch-bar input[type="range"]').fill('1');
      const p1 = page.locator('.ps-branch-side-column').first();
      const p2 = page.locator('.ps-branch-side-column').nth(1);
      await p1.locator('.ps-movebtn:enabled').first().click();
      await p2.locator('.ps-movebtn:enabled').first().click();
      await page.locator('.ps-execute-btn').click();
      const confirm = page.locator('[role="alertdialog"]');
      await expect(confirm).toBeVisible();
      await expect(confirm).toContainText('replace the existing variation from turn 2');
      await confirm.locator('button', { hasText: 'Cancel' }).click();
      await expect(page.locator('.ps-panel', { hasText: 'Variation moves' })).toContainText('Turn 2');

      // The variation stays one click away too.
      await page.locator('.ps-branch-bar input[type="range"]').fill('3');
      await page.locator('.ps-line-chip button', { hasText: 'Variation' }).click();
      await expect(page.locator('iframe[title="Branch Simulation"]')).toBeVisible({ timeout: 10000 });
    });

    test('Let it play out from a main-line turn arms and actually plays', async ({ page }) => {
      test.setTimeout(180_000);
      await page.locator('button', { hasText: 'Load' }).click();
      await expect(page.locator('.ps-branch-bar input[type="range"]')).toBeVisible();

      // Straight from the freshly loaded replay (main line, no variation):
      // the branch rebuild resets the eval to idle, and the loop's first
      // evaluation must fire on its own — this sat at "0 turns played".
      await page.locator('button', { hasText: 'Let it play out' }).click();
      await expect(page.getByText(/Engine is playing both sides from turn 1/)).toBeVisible({ timeout: 60_000 });
      // Proof it actually played: a live counter past zero, or (the small
      // fixture game can finish first) the completion notice with turns.
      await expect.poll(async () => {
        const body = await page.textContent('body');
        return /Engine is playing both sides from turn 1 — [1-9]/.test(body ?? '') ||
          /after [1-9]\d* turns?/.test(body ?? '') ||
          /: [1-9]\d* turns? played/.test(body ?? '');
      }, { timeout: 120_000 }).toBe(true);
      await page.locator('.ps-btn', { hasText: 'Stop' }).click();
      await expect(page.getByText(/Play-out stopped/)).toBeVisible({ timeout: 30_000 });
    });

    test('T0 opens the lead picker and a lead variation plays from turn 0', async ({ page }) => {
      test.setTimeout(120_000);
      await page.locator('button', { hasText: 'Load' }).click();
      await expect(page.locator('.ps-branch-bar input[type="range"]')).toBeVisible();

      // T0 sits on the timeline whether or not a game graph exists; the view
      // swaps the turn pickers for the lead picker with the real leads
      // preselected and badged.
      await page.locator('.ps-branch-bar button[title^="Turn 0"]').click();
      await expect(page.getByText('team preview: pick each side')).toBeVisible();
      const p1Column = page.locator('.ps-branch-side-column').first();
      await expect(p1Column.locator('.ps-switchbtn-selected .ps-played-badge')).toBeVisible();

      // A different P1 lead + play: a fresh game opens at turn 1 and the
      // history records the lead decision as its turn-0 entry.
      await p1Column.locator('.ps-switchbtn:not(.ps-switchbtn-selected)').first().click();
      await page.locator('.ps-execute-btn', { hasText: 'Play from turn 0' }).click();
      await expect(page.getByText(/Branching · Turn 1/)).toBeVisible({ timeout: 60_000 });
      const history = page.locator('.ps-panel', { hasText: 'Variation moves' });
      await expect(history).toContainText('Turn 0');
      await expect(history).toContainText('lead');
      await expect(page.locator('.ps-line-chip button', { hasText: 'Variation' })).toBeVisible();
      await expect(page.locator('iframe[title="Branch Simulation"]')).toBeVisible({ timeout: 10000 });
    });

    test('Let it play out from the T0 view seeds the lead variation', async ({ page }) => {
      test.setTimeout(180_000);
      await page.locator('button', { hasText: 'Load' }).click();
      await expect(page.locator('.ps-branch-bar input[type="range"]')).toBeVisible();
      await page.locator('.ps-branch-bar button[title^="Turn 0"]').click();
      await expect(page.getByText('team preview: pick each side')).toBeVisible();

      // The run must INCLUDE the lead decision: branching at the shared
      // turn-1 prefix produced a variation whose moves list started at
      // turn 1 and whose first turn fell back to the main line.
      await page.locator('button', { hasText: 'Let it play out' }).click();
      const history = page.locator('.ps-panel', { hasText: 'Variation moves' });
      await expect(history).toContainText('Turn 0', { timeout: 60_000 });
      await expect(history).toContainText('lead');

      // When the run ends the pointer returns to turn 1 — a VARIATION
      // position (the line chip stays on gold), not a main-line fallback.
      await expect(page.getByText(/Play-out (finished|stopped)/)).toBeVisible({ timeout: 120_000 });
      await expect(page.getByText('T1/')).toBeVisible();
      await expect(page.locator('.ps-line-chip button.on-vari')).toBeVisible();
    });

    test('doubles T0 picks two leads per side and plays from turn 0', async ({ page }) => {
      test.setTimeout(120_000);
      await page.locator('input[type="text"]').fill('gen9doubles-test');
      await page.locator('button', { hasText: 'Load' }).click();
      await expect(page.getByText('Alice', { exact: true }).first()).toBeVisible({ timeout: 10000 });

      await page.locator('.ps-branch-bar button[title^="Turn 0"]').click();
      await expect(page.getByText('pick both leads per side')).toBeVisible();
      const p1Column = page.locator('.ps-branch-side-column').first();
      // Both real leads come preselected; swapping one lead replaces the
      // oldest pick instead of demanding a deselect first.
      await expect(p1Column.locator('.ps-switchbtn-selected')).toHaveCount(2);
      await p1Column.locator('.ps-switchbtn:not(.ps-switchbtn-selected)').first().click();
      await expect(p1Column.locator('.ps-switchbtn-selected')).toHaveCount(2);

      await page.locator('.ps-execute-btn', { hasText: 'Play from turn 0' }).click();
      await expect(page.getByText(/Branching · Turn 1/)).toBeVisible({ timeout: 60_000 });
      const history = page.locator('.ps-panel', { hasText: 'Variation moves' });
      await expect(history).toContainText('Turn 0');
      // Two leads per side, slot-ordered ("lead X + Y").
      await expect(history).toContainText('+');
      // The doubles branch opens with per-slot controls for all four actives.
      await expect(page.locator('.ps-side-controls')).toHaveCount(4);
    });

    test('VGC T0 picks the brought four and the branch fields only them', async ({ page }) => {
      test.setTimeout(120_000);
      await page.locator('input[type="text"]').fill('gen9vgc-test');
      await page.locator('button', { hasText: 'Load' }).click();
      await expect(page.getByText('Alice', { exact: true }).first()).toBeVisible({ timeout: 10000 });

      // Bring-four preview: six chips per side, the real brought four
      // preselected (leads first).
      await page.locator('.ps-branch-bar button[title^="Turn 0"]').click();
      await expect(page.getByText('pick the 4 each side brings')).toBeVisible();
      const p1Column = page.locator('.ps-branch-side-column').first();
      await expect(p1Column.locator('.ps-switchbtn')).toHaveCount(6);
      await expect(p1Column.locator('.ps-switchbtn-selected')).toHaveCount(4);
      // Swap in a never-brought Pokémon — the oldest pick gives way.
      await p1Column.locator('.ps-switchbtn:not(.ps-switchbtn-selected)', { hasText: 'Flareon' }).click();
      await expect(p1Column.locator('.ps-switchbtn-selected')).toHaveCount(4);

      await page.locator('.ps-execute-btn', { hasText: 'Play from turn 0' }).click();
      await expect(page.getByText(/Branching · Turn 1/)).toBeVisible({ timeout: 60_000 });
      const history = page.locator('.ps-panel', { hasText: 'Variation moves' });
      await expect(history).toContainText('Turn 0');
      await expect(history).toContainText('back');
      // The live branch fields ONLY the chosen four — every evaluation and
      // play-out runs on this battle, so each slot's bench holds exactly 2.
      await expect(page.locator('.ps-side-controls')).toHaveCount(4);
      await expect(page.locator('.ps-side-controls').first().locator('.ps-switchbtn')).toHaveCount(2);
    });
  });
});
