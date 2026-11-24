import { test, expect } from '@playwright/test';
import { expectReplayTurn, installReplayEmbedCache, openTray, pickMove, routeOfflineFixtures, startVariationAt, type ReplayWindow } from './helpers';

test.beforeAll(installReplayEmbedCache);

test.describe('PS Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await routeOfflineFixtures(page);
    await page.goto('/');
  });

  test('branch turn slider updates turn display', async ({ page }) => {
    await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
    const slider = page.locator('input[type="range"]');
    await expect(slider).toBeVisible({ timeout: 10000 });
    await expect(slider).toHaveAttribute('min', '1');
    await slider.fill('2');
    await expect(page.getByText('T2/')).toBeVisible();
  });

  test('branch turn slider seeks without rebuilding the replay iframe', async ({ page }) => {
    await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
    const iframe = page.locator('iframe[title="PS Replay"]');
    await expect(iframe).toBeVisible({ timeout: 10000 });
    const initialSrc = await iframe.getAttribute('src');

    await page.locator('input[type="range"]').fill('2');
    await expect(iframe).toHaveAttribute('src', initialSrc || '');
  });

  test('branch turn slider moves the replay viewer to the selected turn', async ({ page }) => {
    await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
    const iframeHandle = await page.locator('iframe[title="PS Replay"]').elementHandle({ timeout: 10000 });
    const frame = await iframeHandle?.contentFrame();
    expect(frame).toBeTruthy();

    await page.locator('input[type="range"]').fill('2');
    await expectReplayTurn(frame!, 2);
  });

  test('a long forward slider jump lands the scene instead of hanging on "seeking..."', async ({ page }) => {
    test.setTimeout(150_000);
    // A long log makes the embed seek in >300 ms chunks; scene.pause()'s interruptionCount bump could cancel one.
    // The log is synthetic and self-consistent: appended turns of a real fixture would name mons it never introduced.
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
    await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
    const iframeHandle = await page.locator('iframe[title="PS Replay"]').elementHandle({ timeout: 10000 });
    const frame = await iframeHandle?.contentFrame();
    expect(frame).toBeTruthy();
    await expect.poll(async () => frame!.evaluate(() =>
      !!(window as ReplayWindow).Replays?.battle
    ), { timeout: 30_000 }).toBe(true);

    // Throttled CPU, so the fast-forward crosses the 300 ms chunk boundary: the hang shows as a frozen turn counter,
    // slow-but-alive seeking still arrives, so the generous poll separates the two.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    try {
      await page.locator('input[type="range"]').fill('400');
      await expect.poll(async () => frame!.evaluate(() =>
        (window as ReplayWindow).Replays?.battle?.turn ?? -1
      ), { timeout: 90_000 }).toBe(400);
      await expect.poll(async () => frame!.evaluate(() =>
        (window as ReplayWindow).Replays?.battle?.seeking ?? null
      ), { timeout: 15_000 }).toBeNull();
    } finally {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    }
  });

  test('replay iframe keeps a fixed visible height without negative offset', async ({ page }) => {
    await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
    const iframe = page.locator('iframe[title="PS Replay"]');
    await expect(iframe).toBeVisible({ timeout: 10000 });
    await expect(iframe).toHaveCSS('height', '456px');
    await expect(iframe).toHaveCSS('margin-top', '0px');
  });

  test('branch replay iframe keeps the same fixed visible height', async ({ page }) => {
    await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
    await startVariationAt(page, 1);

    const branchIframe = page.locator('iframe[title="Branch Simulation"]');
    await expect(branchIframe).toBeVisible({ timeout: 10000 });
    await expect(branchIframe).toHaveCSS('height', '456px');
    await expect(branchIframe).toHaveCSS('margin-top', '0px');
    await expect(page.locator('iframe')).toHaveCount(1);
  });

  test('a move executed at the selected slider turn opens the variation there', async ({ page }) => {
    await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
    await startVariationAt(page, 2);

    await expect(page.locator('.ps-panel', { hasText: 'Variation moves' })).toContainText('Turn 2');
    await expect(page.getByText(/Variation tip: Turn/)).toBeVisible({ timeout: 15000 });
  });

  test.describe('unified timeline', () => {
    test('navigate back inside the variation and silently truncate on a new move', async ({ page }) => {
      test.setTimeout(120_000);
      await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
      await startVariationAt(page, 1, { p1Move: 'Swords Dance' });
      await pickMove(page, 'p1a');
      await pickMove(page, 'p2a');
      await page.locator('.ps-execute-btn').click();
      await expect(page.locator('.ps-panel', { hasText: 'Variation moves' })).toContainText('Turn 2', { timeout: 60_000 });

      await page.locator('.ps-branch-bar button', { hasText: '◀' }).click();
      await expect(page.getByText('Choices from the reconstructed position')).toBeVisible();
      await expect(page.locator('.ps-line-chip')).toBeVisible();

      // A different P1 move inside the variation raises no confirm: truncation there is silent (chess rules).
      await (await openTray(page, 'p1a')).locator('.ps-movebtn:enabled').nth(1).click();
      await pickMove(page, 'p2a');
      await page.locator('.ps-execute-btn').click();
      await expect(page.locator('[role="alertdialog"]')).toHaveCount(0);
      await expect(page.locator('.ps-panel', { hasText: 'Variation moves' })).toContainText('Turn 2', { timeout: 60_000 });
    });

    test('a move past the variation\'s tip plays on the main line there, after the replace confirm', async ({ page }) => {
      test.setTimeout(120_000);
      await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
      await startVariationAt(page, 1, { p1Move: 'Swords Dance' });
      const history = page.locator('.ps-panel', { hasText: 'Variation moves' });
      await expect(history).not.toContainText('Turn 2');
      await page.locator('.ps-branch-bar button', { hasText: '▶' }).click();
      await expect(page.getByText('T3/')).toBeVisible();
      await expect(page.locator('.ps-line-chip button.on-main')).toBeVisible();

      await pickMove(page, 'p1a');
      await pickMove(page, 'p2a');
      await page.locator('.ps-execute-btn').click();
      const confirm = page.locator('[role="alertdialog"]');
      await expect(confirm).toContainText('You are on the main line (turn 3): replace the existing variation from turn 1');
      await confirm.locator('button', { hasText: 'Replace' }).click();
      await expect(history).toContainText('Turn 3', { timeout: 60_000 });
      await expect(history).not.toContainText('Turn 1');
      await expect(page.locator('.ps-execute-error')).toHaveCount(0);
    });

    test('main line stays one click away and replacing from it asks first', async ({ page }) => {
      test.setTimeout(120_000);
      await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
      await startVariationAt(page, 2);

      await page.locator('.ps-line-chip button', { hasText: 'Main line' }).click();
      await expect(page.locator('iframe[title="PS Replay"]')).toBeVisible({ timeout: 10000 });
      await expect(page.locator('.ps-panel', { hasText: 'Variation moves' })).toContainText('Turn 2');

      await page.locator('.ps-branch-bar input[type="range"]').fill('1');
      await pickMove(page, 'p1a');
      await pickMove(page, 'p2a');
      await page.locator('.ps-execute-btn').click();
      const confirm = page.locator('[role="alertdialog"]');
      await expect(confirm).toBeVisible();
      await expect(confirm).toContainText('replace the existing variation from turn 2');
      await confirm.locator('button', { hasText: 'Cancel' }).click();
      await expect(page.locator('.ps-panel', { hasText: 'Variation moves' })).toContainText('Turn 2');

      await page.locator('.ps-branch-bar input[type="range"]').fill('3');
      await page.locator('.ps-line-chip button', { hasText: 'Variation' }).click();
      await expect(page.locator('iframe[title="Branch Simulation"]')).toBeVisible({ timeout: 10000 });
    });

    test('Let it play out from a main-line turn arms and actually plays', async ({ page }) => {
      test.setTimeout(180_000);
      await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
      await expect(page.locator('.ps-branch-bar input[type="range"]')).toBeVisible();

      await page.locator('button', { hasText: 'Let it play out' }).click();
      await expect(page.getByText(/Engine is playing both sides from turn 1/)).toBeVisible({ timeout: 60_000 });
      // A live counter past zero, or the completion notice: the small fixture game can finish first.
      await expect.poll(async () => {
        const body = await page.textContent('body');
        return /Engine is playing both sides from turn 1\. [1-9]/.test(body ?? '') ||
          /after [1-9]\d* turns?/.test(body ?? '') ||
          /: [1-9]\d* turns? played/.test(body ?? '');
      }, { timeout: 120_000 }).toBe(true);
      await page.locator('.ps-btn', { hasText: 'Stop' }).click();
      await expect(page.getByText(/Play-out stopped/)).toBeVisible({ timeout: 30_000 });
    });

    test('T0 opens the lead picker and a lead variation plays from turn 0', async ({ page }) => {
      test.setTimeout(120_000);
      await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
      await expect(page.locator('.ps-branch-bar input[type="range"]')).toBeVisible();

      await page.locator('.ps-branch-bar button[title^="Turn 0"]').click();
      await expect(page.getByText('team preview: pick each side')).toBeVisible();
      const p1Column = page.locator('.ps-lead-side').first();
      await expect(p1Column.locator('.ps-switchbtn-selected .ps-played-badge')).toBeVisible();

      await p1Column.locator('.ps-switchbtn:not(.ps-switchbtn-selected)').first().click();
      await page.locator('.ps-execute-btn', { hasText: 'Play from turn 0' }).click();
      await expect(page.getByText(/Variation tip: Turn 1/)).toBeVisible({ timeout: 60_000 });
      const history = page.locator('.ps-panel', { hasText: 'Variation moves' });
      await expect(history).toContainText('Turn 0');
      await expect(history).toContainText('lead');
      await expect(page.locator('.ps-line-chip button', { hasText: 'Variation' })).toBeVisible();
      await expect(page.locator('iframe[title="Branch Simulation"]')).toBeVisible({ timeout: 10000 });
    });

    test('Let it play out from the T0 view seeds the lead variation', async ({ page }) => {
      test.setTimeout(180_000);
      await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
      await expect(page.locator('.ps-branch-bar input[type="range"]')).toBeVisible();
      await page.locator('.ps-branch-bar button[title^="Turn 0"]').click();
      await expect(page.getByText('team preview: pick each side')).toBeVisible();

      await page.locator('button', { hasText: 'Let it play out' }).click();
      await expect(page.locator('.ps-playout-progress')).toContainText('from turn 0', { timeout: 60_000 });
      const history = page.locator('.ps-panel', { hasText: 'Variation moves' });
      await expect(history).toContainText('Turn 0', { timeout: 60_000 });
      await expect(history).toContainText('lead');

      await expect(page.getByText(/Play-out (finished|stopped)/)).toBeVisible({ timeout: 120_000 });
      await expect(page.getByRole('button', { name: /Watch from turn 0/ })).toBeVisible();
      await expect(page.locator('.ps-line-chip button.on-vari')).toBeVisible();
    });

    test('doubles T0 picks two leads per side and plays from turn 0', async ({ page }) => {
      test.setTimeout(120_000);
      await page.locator('input[type="text"]').fill('gen9doubles-test');
      await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
      await expect(page.getByText('Alice', { exact: true }).first()).toBeVisible({ timeout: 10000 });

      await page.locator('.ps-branch-bar button[title^="Turn 0"]').click();
      await expect(page.getByText('pick both leads per side')).toBeVisible();
      const p1Column = page.locator('.ps-lead-side').first();
      await expect(p1Column.locator('.ps-switchbtn-selected')).toHaveCount(2);
      await p1Column.locator('.ps-switchbtn:not(.ps-switchbtn-selected)').first().click();
      await expect(p1Column.locator('.ps-switchbtn-selected')).toHaveCount(2);

      await page.locator('.ps-execute-btn', { hasText: 'Play from turn 0' }).click();
      await expect(page.getByText(/Variation tip: Turn 1/)).toBeVisible({ timeout: 60_000 });
      const history = page.locator('.ps-panel', { hasText: 'Variation moves' });
      await expect(history).toContainText('Turn 0');
      await expect(history).toContainText('+');
      await expect(page.locator('.ps-dock-chip')).toHaveCount(4);
    });

    test('VGC T0 picks the brought four and the branch fields only them', async ({ page }) => {
      test.setTimeout(120_000);
      await page.locator('input[type="text"]').fill('gen9vgc-test');
      await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
      await expect(page.getByText('Alice', { exact: true }).first()).toBeVisible({ timeout: 10000 });

      await page.locator('.ps-branch-bar button[title^="Turn 0"]').click();
      await expect(page.getByText('pick the 4 each side brings')).toBeVisible();
      const p1Column = page.locator('.ps-lead-side').first();
      await expect(p1Column.locator('.ps-switchbtn')).toHaveCount(6);
      await expect(p1Column.locator('.ps-switchbtn-selected')).toHaveCount(4);
      await p1Column.locator('.ps-switchbtn:not(.ps-switchbtn-selected)', { hasText: 'Flareon' }).click();
      await expect(p1Column.locator('.ps-switchbtn-selected')).toHaveCount(4);

      await page.locator('.ps-execute-btn', { hasText: 'Play from turn 0' }).click();
      await expect(page.getByText(/Variation tip: Turn 1/)).toBeVisible({ timeout: 60_000 });
      const history = page.locator('.ps-panel', { hasText: 'Variation moves' });
      await expect(history).toContainText('Turn 0');
      await expect(history).toContainText('back');
      // The live branch fields only the chosen four: each slot's bench holds exactly 2.
      await expect(page.locator('.ps-dock-chip')).toHaveCount(4);
      await expect((await openTray(page, 'p1a')).locator('.ps-switchbtn')).toHaveCount(2);
    });

    test('VGC T0 starts again over a standing turn-0 variation once the replace is confirmed', async ({ page }) => {
      test.setTimeout(180_000);
      await page.locator('input[type="text"]').fill('gen9vgc-test');
      await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
      await expect(page.getByText('Alice', { exact: true }).first()).toBeVisible({ timeout: 10000 });
      await page.locator('.ps-branch-bar button[title^="Turn 0"]').click();
      await expect(page.getByText('pick the 4 each side brings')).toBeVisible();
      await page.locator('.ps-execute-btn', { hasText: 'Play from turn 0' }).click();
      await expect(page.getByText(/Variation tip: Turn 1/)).toBeVisible({ timeout: 60_000 });

      await page.locator('.ps-branch-bar button[title^="Turn 0"]').click();
      await expect(page.getByText('pick the 4 each side brings')).toBeVisible();
      await page.locator('.ps-execute-btn', { hasText: 'Play from turn 0' }).click();
      const confirm = page.locator('[role="alertdialog"]');
      await expect(confirm).toContainText('Start a new game from turn 0: replace the existing variation from turn 0');
      await confirm.locator('button', { hasText: 'Replace' }).click();
      await expect(page.getByText(/Variation tip: Turn 1/)).toBeVisible({ timeout: 60_000 });
      await expect(page.locator('.ps-dock-chip')).toHaveCount(4);
      await expect(page.locator('.ps-panel', { hasText: 'Variation moves' })).toContainText('Turn 0');
    });
  });
});
