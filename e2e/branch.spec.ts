import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { expectReplayTurnAtLeast, fixturePath, installReplayEmbedCache, routeOfflineFixtures, startVariationAt, type ReplayWindow } from './helpers';

test.beforeAll(installReplayEmbedCache);

test.describe('PS Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await routeOfflineFixtures(page);
    await page.goto('/');
  });

  test('branch divergence: healed mid-cascade turns branch silently; the ended final turn is guarded', async ({ page }) => {
    // The REAL draft replay (not the shared 4-turn fixture): its endgame
    // is the premature-end family's home — the UNHEALED choice replay dies
    // from turn 56 (five forced switches fed into a kill zone), while the
    // app's per-turn snapshot healing arrives live on every turn through
    // 67. Pin both defenses on the real replay: t56 branches with NO
    // divergence notice (healing works), and the real final turn (68)
    // cannot be branched at all — the button is disabled with the
    // end-position explanation, so the ended-arrival notice stays a
    // defense-in-depth path rather than a reachable state here.
    test.setTimeout(300_000);
    const draftReplay = JSON.parse(readFileSync(fixturePath('draft-replay.json'), 'utf-8'));
    await page.route('**/replay.pokemonshowdown.com/**', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(draftReplay),
    }));
    await page.locator('button', { hasText: 'Load' }).click();
    const slider = page.locator('input[type="range"]');
    await expect(slider).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('puffelmaedchen', { exact: true }).first()).toBeVisible({ timeout: 15_000 });

    await slider.fill('56');
    await expect(page.getByText('T56/')).toBeVisible();
    // Executing a turn here funnels through the same healed reconstruction
    // the old materialize button used — t56 must arrive LIVE and play.
    const p1 = page.locator('.ps-branch-side-column').first();
    const p2 = page.locator('.ps-branch-side-column').nth(1);
    await p1.locator('.ps-movebtn:enabled').first().click();
    await p2.locator('.ps-movebtn:enabled').first().click();
    await page.locator('.ps-execute-btn').click();
    await expect(page.getByText(/Branching · Turn 5[6-9]/)).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText(/already ended|wedged at turn/)).toHaveCount(0);

    await page.locator('button', { hasText: 'Discard variation' }).click();
    await expect(slider).toBeVisible({ timeout: 10_000 });
    await slider.fill('68');
    // The end snapshot is the post-battle sentinel — playing from it (the
    // play-out button included) is refused with the explanation, and no
    // play-out arms.
    await page.locator('button', { hasText: 'Let it play out' }).click();
    await expect(page.getByText(/already over at the end position/)).toBeVisible();
    await expect(page.getByText(/Engine is playing both sides/)).toHaveCount(0);
    await expect(page.getByText(/Branching · Turn/)).toHaveCount(0);
  });

  test('the branch sim iframe follows the played variation line', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    await startVariationAt(page, 2);

    // After executing turn 2 the sim (and the pointer) stand one past it —
    // the appended-turn animation settles there on its own.
    const iframeHandle = await page.locator('iframe[title="Branch Simulation"]').elementHandle({ timeout: 10000 });
    const frame = await iframeHandle?.contentFrame();
    expect(frame).toBeTruthy();
    await expectReplayTurnAtLeast(frame!, 2);
  });

  test('an executed move replaces the replay iframe with the branch sim', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    await startVariationAt(page, 1);

    await expect(page.getByText(/Branching · Turn/)).toBeVisible({ timeout: 15000 });
    await expect(page.locator('button', { hasText: 'Discard variation' })).toBeVisible();

    await expect(page.locator('iframe[title="Branch Simulation"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('iframe')).toHaveCount(1);
  });

  test('executing a branch turn keeps the branch replay iframe mounted', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    await startVariationAt(page, 1);

    // Swords Dance for P1 (no damage — a max-damage pick can crit-KO and
    // turn P2's controls into a forced-switch prompt), any move for P2.
    await page.locator('.ps-branch-side-column').first().locator('.ps-movebtn', { hasText: 'Swords Dance' }).click();
    await page.locator('.ps-branch-side-column').nth(1).locator('.ps-movebtn').first().click();
    const iframe = await page.locator('iframe[title="Branch Simulation"]').elementHandle();
    await page.locator('button', { hasText: 'Execute Turn' }).click();

    await expect(page.locator('.ps-panel', { hasText: 'Variation moves' })).toContainText('Turn 2', { timeout: 15000 });
    const sameIframe = await page.locator('iframe[title="Branch Simulation"]').evaluate((el, previous) => el === previous, iframe);
    expect(sameIframe).toBe(true);
  });

  test('branch replay follows appended branch events and keeps iframe turn controls usable', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    await expect(page.locator('iframe[title="PS Replay"]')).toBeVisible({ timeout: 10000 });
    await startVariationAt(page, 2);

    const iframeHandle = await page.locator('iframe[title="Branch Simulation"]').elementHandle({ timeout: 10000 });
    const frame = await iframeHandle?.contentFrame();
    expect(frame).toBeTruthy();
    await expectReplayTurnAtLeast(frame!, 2);

    const logLength = () =>
      frame!.evaluate(() => (document.querySelector('.battle-log')?.textContent ?? '').length);
    const beforeLength = await logLength();

    const p1Side = page.locator('.ps-branch-side-column').first();
    const p2Side = page.locator('.ps-branch-side-column').nth(1);
    await p1Side.locator('.ps-movebtn:enabled').first().click();
    await p2Side.locator('.ps-movebtn:enabled').first().click();
    await page.locator('.ps-execute-btn').click();

    // The appended turn grows the visible log — a marker that does not
    // depend on damage rolls, KOs, or the inferred spreads.
    await expect.poll(logLength).toBeGreaterThan(beforeLength + 20);
    const afterLength = await logLength();
    await expect.poll(async () =>
      frame!.evaluate(() => (document.querySelector('.battle-log')?.textContent ?? '').match(/Battle started/g)?.length ?? 0)
    ).toBe(1);

    await frame!.locator('button', { hasText: 'Last turn' }).click();
    await expect.poll(logLength).toBeLessThan(afterLength);

    await frame!.locator('button', { hasText: 'Next turn' }).click();
    await frame!.locator('button', { hasText: 'Next turn' }).click();
    await expect.poll(logLength).toBeGreaterThanOrEqual(afterLength);
  });

  test('branch execution defaults to animating the appended turn', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    await startVariationAt(page, 2);

    const animateToggle = page.getByLabel('Animate branch turns');
    await expect(animateToggle).toBeVisible();
    await expect(animateToggle).toBeChecked();

    const iframeHandle = await page.locator('iframe[title="Branch Simulation"]').elementHandle({ timeout: 10000 });
    const frame = await iframeHandle?.contentFrame();
    expect(frame).toBeTruthy();
    await iframeHandle!.evaluate((iframe: HTMLIFrameElement) => {
      const targetWindow = iframe.contentWindow as ReplayWindow | null;
      if (!targetWindow || targetWindow.__psPostedMessages) return;
      const originalPostMessage = targetWindow.postMessage.bind(targetWindow);
      targetWindow.__psPostedMessages = [];
      targetWindow.postMessage = ((message: unknown, targetOrigin: string, transfer?: Transferable[]) => {
        targetWindow.__psPostedMessages?.push(message);
        return originalPostMessage(message, targetOrigin, transfer as never);
      }) as Window['postMessage'];
    });

    const p1Side = page.locator('.ps-branch-side-column').first();
    const p2Side = page.locator('.ps-branch-side-column').nth(1);
    await p1Side.locator('.ps-movebtn:enabled').first().click();
    await p2Side.locator('.ps-movebtn:enabled').first().click();
    await page.locator('.ps-execute-btn').click();

    // startVariationAt already executed turn 2 (and resolved its forced
    // replacement), so the instrumented append plays from turn 3.
    await expect.poll(async () => frame!.evaluate(() =>
      (window as ReplayWindow).__psPostedMessages?.some(message => {
        const data = message as { type?: string; playFromTurn?: number };
        return data.type === 'ps-append-log' && data.playFromTurn === 3;
      }) ?? false
    )).toBe(true);
    await expectReplayTurnAtLeast(frame!, 3);
  });

  test('branch replay play controls stay muted without audio errors', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.locator('button', { hasText: 'Load' }).click();
    await expect(page.locator('iframe[title="PS Replay"]')).toBeVisible({ timeout: 10000 });
    await startVariationAt(page, 2);

    const iframeHandle = await page.locator('iframe[title="Branch Simulation"]').elementHandle({ timeout: 10000 });
    const frame = await iframeHandle?.contentFrame();
    expect(frame).toBeTruthy();
    await expectReplayTurnAtLeast(frame!, 2);

    // The appended turn auto-plays (animate default) — pause first so the
    // explicit Play click below exists in either player state.
    const pauseButton = frame!.locator('button', { hasText: 'Pause' });
    if (await pauseButton.isVisible().catch(() => false)) await pauseButton.click();
    await frame!.locator('button', { hasText: 'Play' }).click();
    await expect.poll(async () =>
      frame!.evaluate(() => Boolean((window as ReplayWindow).Replays?.battle && !(window as ReplayWindow).Replays?.battle?.paused))
    ).toBe(true);
    expect(pageErrors).toHaveLength(0);
  });

  test('branch replay iframe does not shrink as history grows', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    // P1 plays Swords Dance — a max-damage Earthquake can crit-KO Kingambit
    // on turn 1, which turns P2's controls into a forced-switch prompt.
    await startVariationAt(page, 1, { p1Move: 'Swords Dance' });

    const branchIframe = page.locator('iframe[title="Branch Simulation"]');
    const initialBox = await branchIframe.boundingBox();

    const p1Controls = page.locator('.ps-branch-side-column').first();
    const p2Controls = page.locator('.ps-branch-side-column').nth(1);
    await p1Controls.locator('.ps-movebtn', { hasText: 'Swords Dance' }).click();
    await p2Controls.locator('.ps-movebtn').first().click();
    await page.locator('button', { hasText: 'Execute Turn' }).click();
    await expect(page.locator('.ps-panel', { hasText: 'Variation moves' })).toContainText('Turn 2', { timeout: 10000 });

    const finalBox = await branchIframe.boundingBox();
    expect(finalBox?.height).toBe(initialBox?.height);
    await expect(branchIframe).toHaveCSS('height', '480px');
  });

  test('desktop branch controls keep both sides and Execute Turn in the first viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('button', { hasText: 'Load' }).click();
    await page.locator('input[type="range"]').fill('2');
    await expect(page.getByText('T2/')).toBeVisible();

    const p1Controls = page.locator('.ps-branch-side-column').nth(0);
    const p2Controls = page.locator('.ps-branch-side-column').nth(1);
    await expect(p1Controls).toContainText('What will Garchomp do?');
    await expect(p2Controls).toContainText(/What will .* do\?/);

    const executeBox = await page.locator('.ps-execute-btn').boundingBox();
    expect(executeBox).toBeTruthy();
    expect((executeBox?.y ?? Number.POSITIVE_INFINITY) + (executeBox?.height ?? 0)).toBeLessThanOrEqual(1000);
  });

  test('mobile branch layout keeps replay controls before the stats panel', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.reload();

    await page.locator('button', { hasText: 'Load' }).click();
    await startVariationAt(page, 1);

    const leftColumn = page.locator('.ps-main-left');
    const statsColumn = page.locator('.ps-main-right');
    const branchIframe = page.locator('iframe[title="Branch Simulation"]');
    await expect(branchIframe).toBeVisible({ timeout: 10000 });

    const leftOverflow = await leftColumn.evaluate(element => getComputedStyle(element).overflowY);
    const leftBox = await leftColumn.boundingBox();
    const iframeBox = await branchIframe.boundingBox();
    const statsBox = await statsColumn.boundingBox();

    expect(leftOverflow).toBe('visible');
    expect(leftBox?.height).toBeGreaterThan(560);
    expect(statsBox?.y).toBeGreaterThan((iframeBox?.y ?? 0) + (iframeBox?.height ?? 0));
  });

  test('an open variation exposes save and share controls', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    await startVariationAt(page, 1);

    await expect(page.locator('button', { hasText: 'Save Branch' })).toBeVisible({ timeout: 5000 });
    await page.locator('button', { hasText: 'Copy Share Link' }).click();
    await expect(page.locator('input[aria-label="Branch share link"]')).toHaveValue(/#branch=/);
  });

  test('Discard variation drops the variation and returns to the replay', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    await startVariationAt(page, 1);

    await page.locator('button', { hasText: 'Discard variation' }).click();
    await expect(page.getByText(/Branching · Turn/)).toHaveCount(0);
    await expect(page.locator('iframe[title="PS Replay"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.ps-branch-bar input[type="range"]')).toBeVisible();
  });
});
