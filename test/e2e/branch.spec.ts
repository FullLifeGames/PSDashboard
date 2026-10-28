import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { expectReplayTurnAtLeast, fixturePath, installReplayEmbedCache, routeOfflineFixtures, routeSlowReplayEmbed, startVariationAt, type ReplayWindow } from './helpers';

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

  // Round 70 (user gate 17.10., 2a): known red until T243. Under the log's dice p2 sends Heatran into Mienshao's Knock Off
  // at turn 61 and p1 wins at turn 67. Over 16 arrival dice in Node (probe docs/perf/probes/2026-10-15-playout) v1 wins 16
  // for p2 and passes this pin 14 times, round 70 wins 14 and passes 12; head to head, round 70 as p2 wins 16 of 16
  // against v1 as p1, and round 70 as p1 takes one of 16 from v1 as p2. The pin stays the target: T243 measures the four
  // pairings again after the re-fit T224.
  // Round 76 (T243 with T258): the healer race follows the simulator's sequence of hits and heals, and over the 16 dice
  // the engine against itself wins 16 for p2 and passes this pin 14 times (v1 of round 69 the same; probe
  // docs/perf/probes/2026-10-23-r76/lanes/S/playout), so the pin is armed again.
  test('the draft t56 play-out wins for p2 without crawling (round 42)', async ({ page }) => {
    // Round 19 finding, round 42 pin: from turn 56 (p1 Kyurem Ice Beam, p2
    // into Slowking) the play-out used to send Heatran into Mienshao's Knock
    // Off at turn 62 and lose it, then crawl 21 turns to a 5% win. With the
    // forced switch searched as a tree node the engine sacks Muk-Alola first
    // (turn 58) and keeps Heatran for the finish (turn 65, 59% HP left).
    // Round 63 (T16, every verified outcome one ply deeper): the play-out
    // follows the Monte-Carlo ranking at turn 59 (p1 Stealth Rock, p2 Scald)
    // and p2 wins at turn 62 without sending either.
    // Round 64 (user gate 08.10., "2a"): the pin keeps the intent, not the
    // switch order. Muk-Alola is p2's top switch in no line, and the order
    // held only through near ties (0.001 to 0.005) that the Monte-Carlo
    // reference decides the other way; with the state-split verify step (T119)
    // p2 sends Heatran at turn 61 and wins at turn 66. What the pin forbids is
    // the crawl: p2 (Bene) wins the play-out by turn 70.
    // Round 67 (user gate 11.10., "5b"): at turn 57 Iron Head, Earth Power and
    // Freeze-Dry lie within 0.01 and the Monte-Carlo reference decides none of
    // them; the line it plays wins at turn 72 after six p2 switches, the
    // turn-56 switch into Slowking included (every other turn-57 choice wins by
    // turn 66). The pin keeps the core: p2 wins by turn 75 with at most six
    // switches.
    // Nicknames in the history rows: Sludge Shadow = Muk-Alola, Fire Shadow = Heatran.
    test.setTimeout(600_000);
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
    const p1 = page.locator('.ps-branch-side-column').first();
    const p2 = page.locator('.ps-branch-side-column').nth(1);
    await p1.locator('.ps-movebtn', { hasText: 'Ice Beam' }).click();
    await p2.locator('.ps-switchbtn', { hasText: 'Slow Shadow' }).click();
    await page.locator('.ps-execute-btn').click();
    await expect(page.locator('.ps-panel', { hasText: 'Variation moves' })).toContainText('Turn 56', { timeout: 120_000 });

    await page.locator('button', { hasText: 'Let it play out' }).click();
    await expect(page.getByText(/Play-out finished|Play-out stopped/)).toBeVisible({ timeout: 500_000 });
    const lines = (await page.locator('.ps-panel', { hasText: 'Variation moves' }).innerText()).split('\n');
    // P2's switch targets in play order: the right half of a turn's move row
    // when it is a switch, and the forced-replacement rows of P2.
    const p2Switches: string[] = [];
    lines.forEach((line, index) => {
      const forced = /forced replacement \(P2\): → (.+)$/.exec(line);
      if (forced) p2Switches.push(forced[1].trim());
      if (/^Turn \d+$/.test(line.trim())) {
        const p2Part = (lines[index + 1] ?? '').split(' | ')[1] ?? '';
        if (p2Part.startsWith('→ ')) p2Switches.push(p2Part.slice(2).trim());
      }
    });
    const lastTurn = Number(/Branching · Turn (\d+)/.exec(await page.getByText(/Branching · Turn \d+/).innerText())?.[1]);
    const line = `ended at turn ${lastTurn}, p2 switches: ${p2Switches.join(', ')}`;
    await expect(page.locator('.ps-branch-ended'), line).toContainText('Bene wins this variation.');
    expect(lastTurn, line).toBeLessThanOrEqual(75);
    expect(p2Switches.length, line).toBeLessThanOrEqual(6);
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

  test('one turn back in a turn-0 variation and a new choice: the branch frame plays the new turn alone (round 77)', async ({ page }) => {
    // User report 28.10.2026: in the draft replay, a few turns from turn 0, one turn back and a new choice. The rebuild kept
    // the variation right, but the frame kept the old line and the new turn appended after its tail: the frame played the
    // old attack and then the new one. With that fixed, the frame reloaded for the rebuilt line and the new turn went out
    // while the embed script still loaded, so the frame never showed it. The embed comes a second late here, as from the
    // network. Turn 2 is Ice Beam first and Freeze-Dry after the step back.
    test.setTimeout(180_000);
    await routeSlowReplayEmbed(page, 1000);
    const draftReplay = JSON.parse(readFileSync(fixturePath('draft-replay.json'), 'utf-8'));
    await page.route('**/replay.pokemonshowdown.com/**', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(draftReplay),
    }));
    await page.locator('button', { hasText: 'Load' }).click();
    await expect(page.getByText('puffelmaedchen', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await page.locator('.ps-branch-bar button[title^="Turn 0"]').click();
    await page.locator('.ps-execute-btn', { hasText: 'Play from turn 0' }).click();
    await expect(page.getByText(/Branching · Turn 1/)).toBeVisible({ timeout: 60_000 });

    const p1 = page.locator('.ps-branch-side-column').first();
    const p2 = page.locator('.ps-branch-side-column').nth(1);
    const history = page.locator('.ps-panel', { hasText: 'Variation moves' });
    // Turn 1: U-turn and Chilly Reception, each side then sends its first switch-in.
    await p1.locator('.ps-movebtn', { hasText: 'U-turn' }).click();
    await p2.locator('.ps-movebtn', { hasText: 'Chilly Reception' }).click();
    await page.locator('.ps-execute-btn').click();
    for (const side of ['P1', 'P2']) {
      const forced = page.locator('.ps-side-controls', { has: page.locator('.ps-force-switch-note') }).first();
      await forced.locator('.ps-switchbtn:enabled').first().click();
      await expect(history).toContainText(`forced replacement (${side})`, { timeout: 30_000 });
    }
    // Turn 2 as played first, then one turn back and Freeze-Dry instead.
    await p1.locator('.ps-movebtn', { hasText: 'Ice Beam' }).click();
    await p2.locator('.ps-movebtn', { hasText: 'Close Combat' }).click();
    await page.locator('.ps-execute-btn').click();
    await expect(history).toContainText('Ice Beam | Close Combat', { timeout: 60_000 });
    await page.locator('.ps-branch-bar button', { hasText: '◀' }).click();
    await expect(page.getByText('T2/')).toBeVisible();
    await p1.locator('.ps-movebtn', { hasText: 'Freeze-Dry' }).click();
    await p2.locator('.ps-movebtn', { hasText: 'Close Combat' }).click();
    await page.locator('.ps-execute-btn').click();
    await expect(history).toContainText('Freeze-Dry | Close Combat', { timeout: 60_000 });
    await expect(history).not.toContainText('Ice Beam | Close Combat');

    // The frame holds the variation's moves, each once: the old turn 2 is gone.
    await page.locator('.ps-log-toggle').click();
    const simMoves = (await page.locator('.ps-log').innerText()).split('\n').filter(line => line.startsWith('|move|'));
    expect(simMoves.some(line => line.includes('|Freeze-Dry|'))).toBe(true);
    const frame = await (await page.locator('iframe[title="Branch Simulation"]').elementHandle({ timeout: 10_000 }))?.contentFrame();
    expect(frame).toBeTruthy();
    await expect.poll(async () => frame!.evaluate(() =>
      ((window as ReplayWindow & { Replays?: { battle?: { stepQueue?: string[] } } }).Replays?.battle?.stepQueue ?? [])
        .filter(line => line.startsWith('|move|'))
    ), { timeout: 30_000 }).toEqual(simMoves);
    // And it shows the new turn: the frame plays through turn 2 to the variation's tip.
    await expectReplayTurnAtLeast(frame!, 3);
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

    await page.getByRole('button', { name: 'Setup', exact: true }).click();
    const animateToggle = page.getByLabel('Animate branch turns');
    await expect(animateToggle).toBeVisible();
    await expect(animateToggle).toBeChecked();
    await page.keyboard.press('Escape');

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
    await expect(branchIframe).toHaveCSS('height', '456px');
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

test.describe('the branch frame plays executed turns', () => {
  test.beforeEach(async ({ page }) => {
    await routeOfflineFixtures(page);
    await page.goto('/');
  });

  test('the first turn of a new variation plays in from its start (round 77)', async ({ page }) => {
    // User report 28.10.2026: Iron Head into Recover opened a variation, and the frame showed the end of that turn at
    // once, while every later turn played out. The branch frame mounts after the turn ran; it opens on the turn's start.
    await page.locator('button', { hasText: 'Load' }).click();
    await page.locator('.ps-branch-bar input[type="range"]').fill('2');
    await expect(page.getByText('T2/')).toBeVisible();
    await page.locator('.ps-branch-side-column').first().locator('.ps-movebtn', { hasText: 'Swords Dance' }).click();
    await page.locator('.ps-branch-side-column').nth(1).locator('.ps-movebtn:enabled').first().click();
    await page.locator('.ps-execute-btn').click();

    type Sample = { turn: number; paused: boolean; seeking: number | null };
    const samples: Sample[] = [];
    await expect.poll(async () => {
      const handle = await page.locator('iframe[title="Branch Simulation"]').elementHandle({ timeout: 100 }).catch(() => null);
      const frame = await handle?.contentFrame();
      const sample = await frame?.evaluate(() => {
        const battle = (window as ReplayWindow).Replays?.battle;
        return battle ? { turn: battle.turn ?? -1, paused: !!battle.paused, seeking: battle.seeking ?? null } : null;
      }).catch(() => null);
      if (sample) samples.push(sample as Sample);
      return sample?.turn ?? -1;
    }, { timeout: 60_000, intervals: [100] }).toBeGreaterThanOrEqual(3);
    expect(samples.some(sample => sample.turn === 2 && !sample.paused && sample.seeking === null)).toBe(true);
  });
});
