import { test, expect, type Frame, type Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { encodeBranchShare, type BranchSharePayload } from '../src/lib/branch-share';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const fixtureReplay = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'replay.json'), 'utf-8'),
);

const doublesReplay = {
  id: 'gen9doubles-test',
  format: '[Gen 9] Doubles OU',
  formatid: 'gen9doublesou',
  players: ['Alice', 'Bob'],
  uploadtime: 0,
  views: 0,
  log: [
    '|player|p1|Alice|',
    '|player|p2|Bob|',
    '|gametype|doubles',
    '|gen|9',
    '|tier|[Gen 9] Doubles OU',
    '|clearpoke',
    '|poke|p1|Pikachu, L50|item',
    '|poke|p1|Eevee, L50|item',
    '|poke|p1|Raichu, L50|',
    '|poke|p1|Jolteon, L50|',
    '|poke|p2|Bulbasaur, L50|item',
    '|poke|p2|Charmander, L50|item',
    '|poke|p2|Squirtle, L50|',
    '|poke|p2|Ivysaur, L50|',
    '|c| Alice|/raw <div class="infobox"><details><summary>View team</summary>Pikachu @ Light Ball<br />Ability: Static<br />EVs: 4 HP &#x2f; 252 SpA &#x2f; 252 Spe<br />Timid Nature<br />- Thunderbolt<br />- Quick Attack<br />- Protect<br /><br />Eevee @ Eviolite<br />Ability: Adaptability<br />EVs: 252 Atk &#x2f; 4 SpD &#x2f; 252 Spe<br />Jolly Nature<br />- Tackle<br />- Quick Attack<br />- Protect<br /><br />Raichu<br />Ability: Static<br />- Thunderbolt<br />- Protect<br /><br />Jolteon<br />Ability: Volt Absorb<br />- Thunderbolt<br />- Protect<br /></details></div>',
    '|c| Bob|/raw <div class="infobox"><details><summary>View team</summary>Bulbasaur @ Eviolite<br />Ability: Overgrow<br />- Vine Whip<br />- Protect<br /><br />Charmander @ Eviolite<br />Ability: Blaze<br />- Ember<br />- Protect<br /><br />Squirtle<br />Ability: Torrent<br />- Water Gun<br />- Protect<br /><br />Ivysaur<br />Ability: Overgrow<br />- Vine Whip<br />- Protect<br /></details></div>',
    '|teampreview',
    '|',
    '|start',
    '|switch|p1a: Pikachu|Pikachu, L50|100/100',
    '|switch|p1b: Eevee|Eevee, L50|100/100',
    '|switch|p2a: Bulbasaur|Bulbasaur, L50|100/100',
    '|switch|p2b: Charmander|Charmander, L50|100/100',
    '|turn|1',
  ].join('\n'),
};

// A bring-four format: 6 at preview, 4 in the game (leads + 2 switched in).
const vgcReplay = {
  id: 'gen9vgc-test',
  format: '[Gen 9] VGC 2026 Regulation I',
  formatid: 'gen9vgc2026regi',
  players: ['Alice', 'Bob'],
  uploadtime: 0,
  views: 0,
  log: [
    '|player|p1|Alice|',
    '|player|p2|Bob|',
    '|gametype|doubles',
    '|gen|9',
    '|tier|[Gen 9] VGC 2026 Regulation I',
    '|clearpoke',
    '|poke|p1|Pikachu, L50|item',
    '|poke|p1|Eevee, L50|item',
    '|poke|p1|Raichu, L50|',
    '|poke|p1|Jolteon, L50|',
    '|poke|p1|Flareon, L50|',
    '|poke|p1|Vaporeon, L50|',
    '|poke|p2|Bulbasaur, L50|item',
    '|poke|p2|Charmander, L50|item',
    '|poke|p2|Squirtle, L50|',
    '|poke|p2|Ivysaur, L50|',
    '|poke|p2|Charmeleon, L50|',
    '|poke|p2|Wartortle, L50|',
    '|c| Alice|/raw <div class="infobox"><details><summary>View team</summary>Pikachu @ Light Ball<br />Ability: Static<br />- Thunderbolt<br />- Protect<br /><br />Eevee @ Eviolite<br />Ability: Adaptability<br />- Tackle<br />- Protect<br /><br />Raichu<br />Ability: Static<br />- Thunderbolt<br />- Protect<br /><br />Jolteon<br />Ability: Volt Absorb<br />- Thunderbolt<br />- Protect<br /><br />Flareon<br />Ability: Flash Fire<br />- Ember<br />- Protect<br /><br />Vaporeon<br />Ability: Water Absorb<br />- Water Gun<br />- Protect<br /></details></div>',
    '|c| Bob|/raw <div class="infobox"><details><summary>View team</summary>Bulbasaur @ Eviolite<br />Ability: Overgrow<br />- Vine Whip<br />- Protect<br /><br />Charmander @ Eviolite<br />Ability: Blaze<br />- Ember<br />- Protect<br /><br />Squirtle<br />Ability: Torrent<br />- Water Gun<br />- Protect<br /><br />Ivysaur<br />Ability: Overgrow<br />- Vine Whip<br />- Protect<br /><br />Charmeleon<br />Ability: Blaze<br />- Ember<br />- Protect<br /><br />Wartortle<br />Ability: Torrent<br />- Water Gun<br />- Protect<br /></details></div>',
    '|teampreview',
    '|',
    '|start',
    '|switch|p1a: Pikachu|Pikachu, L50|100/100',
    '|switch|p1b: Eevee|Eevee, L50|100/100',
    '|switch|p2a: Bulbasaur|Bulbasaur, L50|100/100',
    '|switch|p2b: Charmander|Charmander, L50|100/100',
    '|turn|1',
    '|switch|p1a: Raichu|Raichu, L50|100/100',
    '|switch|p2a: Squirtle|Squirtle, L50|100/100',
    '|turn|2',
    '|switch|p1b: Jolteon|Jolteon, L50|100/100',
    '|switch|p2b: Ivysaur|Ivysaur, L50|100/100',
    '|turn|3',
  ].join('\n'),
};

const sharedBranchPayload: BranchSharePayload = {
  version: 1,
  replayId: fixtureReplay.id,
  format: fixtureReplay.format,
  formatid: fixtureReplay.formatid,
  players: fixtureReplay.players,
  branchTurn: 2,
  createdAt: '2026-04-29T08:00:00.000Z',
  choices: [{ turnNumber: 2, p1Choice: 'move 1', p2Choice: 'move 2' }],
  finalLog: fixtureReplay.log,
};

type ReplayWindow = Window & {
  Replays?: {
    battle?: {
      turn?: number;
      currentStep?: number;
      paused?: boolean;
      seeking?: number | null;
      viewpointSwitched?: boolean;
    };
  };
  __psPostedMessages?: unknown[];
};

async function expectReplayTurn(
  frame: Frame,
  turn: number,
) {
  // The embed script loads from play.pokemonshowdown.com; under full-suite
  // load it can take a while before Replays.battle exists at all — wait for
  // readiness first so slow CDN responses don't eat the turn timeout (G25).
  await expect.poll(async () => frame.evaluate(() =>
    !!(window as ReplayWindow).Replays?.battle
  ), { timeout: 30_000 }).toBe(true);
  await expect.poll(async () => frame.evaluate(() =>
    (window as ReplayWindow).Replays?.battle?.turn ?? -1
  ), { timeout: 15_000 }).toBe(turn);
}

/** Like expectReplayTurn, but tolerant of live-append animation timing: the
 *  appended turn may still be playing, so the battle only needs to have
 *  REACHED the turn (it settles at the log's end on its own). */
async function expectReplayTurnAtLeast(frame: Frame, turn: number) {
  await expect.poll(async () => frame.evaluate(() =>
    !!(window as ReplayWindow).Replays?.battle
  ), { timeout: 30_000 }).toBe(true);
  await expect.poll(async () => frame.evaluate(() =>
    (window as ReplayWindow).Replays?.battle?.turn ?? -1
  ), { timeout: 30_000 }).toBeGreaterThanOrEqual(turn);
}

/**
 * Unified-timeline helper: moves the slider to `turn`, picks a move for both
 * sides from the ALWAYS-visible pickers (variant B), executes, and waits for
 * the rebuilt sim's history entry — after this a live variation covers
 * `turn` and the pointer sits on its tip.
 */
async function startVariationAt(page: Page, turn: number, options?: { p1Move?: string | RegExp }) {
  if (turn > 1) {
    await page.locator('.ps-branch-bar input[type="range"]').fill(String(turn));
    await expect(page.getByText(`T${turn}/`)).toBeVisible();
  }
  const p1 = page.locator('.ps-branch-side-column').first();
  const p2 = page.locator('.ps-branch-side-column').nth(1);
  if (options?.p1Move) {
    await p1.locator('.ps-movebtn', { hasText: options.p1Move }).click();
  } else {
    await p1.locator('.ps-movebtn:enabled').first().click();
  }
  await p2.locator('.ps-movebtn:enabled').first().click();
  await page.locator('.ps-execute-btn').click();
  await expect(page.locator('.ps-panel', { hasText: 'Variation moves' }))
    .toContainText(`Turn ${turn}`, { timeout: 60_000 });
  // A first-move KO is common — resolve the trailing forced replacement so
  // callers always get both sides' pickers back. The compact picker shows
  // switch chips at every position, so the forced state is detected via its
  // prompt, never via mere switch-button visibility.
  const forcedNote = page.locator('.ps-force-switch-note').first();
  await forcedNote.waitFor({ state: 'visible', timeout: 4000 }).catch(() => {});
  if (await forcedNote.isVisible().catch(() => false)) {
    const forcedControls = page.locator('.ps-side-controls', { has: page.locator('.ps-force-switch-note') }).first();
    await forcedControls.locator('.ps-switchbtn:enabled').first().click();
    await expect(page.locator('.ps-panel', { hasText: 'Variation moves' }))
      .toContainText('forced replacement', { timeout: 30_000 });
  }
  for (const side of [p1, p2]) {
    await expect(side.locator('.ps-movebtn').first()).toBeVisible({ timeout: 30_000 });
  }
}

/** Waits for the dwell upgrade: after ~1s on a main-line turn the app
 *  reconstructs the exact position in the background and the snapshot
 *  approximation upgrades in place (no button — the unified timeline's
 *  exactness promise). */
async function waitForExactPickers(page: Page, turn?: number) {
  if (turn && turn > 1) {
    await page.locator('.ps-branch-bar input[type="range"]').fill(String(turn));
    await expect(page.getByText(`T${turn}/`)).toBeVisible();
  }
  await expect(page.getByText('Choices from the reconstructed position')).toBeVisible({ timeout: 90_000 });
}

// The embed script is fetched from play.pokemonshowdown.com by every test's
// iframe; occasional CDN stalls were the root of the flaky `Replays.battle`
// timeouts (G25). Fetch it once per run and serve all tests from memory.
let replayEmbedCache: Buffer | null = null;

test.beforeAll(async () => {
  try {
    const response = await fetch('https://play.pokemonshowdown.com/js/replay-embed.js');
    if (response.ok) replayEmbedCache = Buffer.from(await response.arrayBuffer());
  } catch {
    // Fall through — tests then hit the CDN directly like before.
  }
});

/** The offline routes every dashboard test starts from: cached replay embed, fixture replays, empty Smogon data. */
async function routeOfflineFixtures(page: Page): Promise<void> {
  await page.route('**/play.pokemonshowdown.com/js/replay-embed.js*', async (route) => {
    if (replayEmbedCache) {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: replayEmbedCache,
      });
      return;
    }
    await route.continue().catch(() => {});
  });
  await page.route('**/replay.pokemonshowdown.com/**', (route) => {
    const url = route.request().url();
    const replay = url.includes(vgcReplay.id) ? vgcReplay
      : url.includes(doublesReplay.id) ? doublesReplay
      : fixtureReplay;
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(replay),
    });
  });
  await page.route('https://data.pkmn.cc/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) }));
}

test.describe('PS Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await routeOfflineFixtures(page);
    await page.goto('/');
  });

  test('renders the app header', async ({ page }) => {
    await expect(page.locator('h1')).toHaveText('PS Dashboard');
  });

  test('shows replay loader with URL input and load button', async ({ page }) => {
    const input = page.locator('input[type="text"]');
    await expect(input).toBeVisible();
    await expect(input).toHaveValue(/replay\.pokemonshowdown\.com/);
    await expect(page.locator('button', { hasText: 'Load' })).toBeVisible();
  });

  test('defaults to the featured draft replay', async ({ page }) => {
    await expect(page.locator('input[type="text"]')).toHaveValue(/gen9draft-2058494320/);
  });

  test('loads an exported replay HTML file from disk', async ({ page }) => {
    await page.locator('input[aria-label="Load exported replay file"]')
      .setInputFiles(join(__dirname, 'fixtures', 'exported-replay.html'));

    await expect(page.getByText('Alpha', { exact: true }).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Beta', { exact: true }).first()).toBeVisible();
    await expect(page.locator('text=[Gen 9] Draft')).toBeVisible();
    await expect(page.locator('iframe[title="PS Replay"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.ps-branch-bar input[type="range"]')).toBeVisible();
  });

  test('shows a notice when the Smogon sets fail to load', async ({ page }) => {
    // Both data hosts unreachable: the fallback runs dry and the top bar says so.
    await page.route('https://data.pkmn.cc/**', route => route.abort());
    await page.route('https://pkmn.github.io/smogon/data/**', route => route.abort());
    await page.locator('button', { hasText: 'Load' }).click();
    await expect(page.getByText('Smogon sets unavailable')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Smogon stats unavailable')).toBeVisible();
  });

  test('displayed set guesses pass the coherence vetoes (GPL Cobalion)', async ({ page }) => {
    // Deterministic usage payload: Body Press tops the marginals while the
    // replay reveals Swords Dance — the panel must show the vetoed assembly
    // the simulator builds, never a second raw-usage guess (the GPL split).
    await page.route('https://data.pkmn.cc/**', (route) => {
      if (route.request().url().includes('/stats/')) {
        route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({
            pokemon: {
              Cobalion: {
                count: 100,
                abilities: { Justified: 1 },
                items: { Leftovers: 0.5 },
                moves: { 'Iron Head': 0.8, 'Body Press': 0.7, 'Stone Edge': 0.5, 'Close Combat': 0.4 },
                spreads: {},
              },
            },
          }),
        });
        return;
      }
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
    });
    await page.locator('input[aria-label="Load exported replay file"]')
      .setInputFiles(join(__dirname, 'fixtures', 'gpl-replay.html'));

    const cobalion = page.locator('.ps-stats-pokemon', { hasText: 'Cobalion' });
    await expect(cobalion.getByText('Swords Dance')).toBeVisible({ timeout: 15000 });
    await expect(cobalion.getByText('Close Combat')).toBeVisible();
    await expect(cobalion.getByText('Body Press')).toHaveCount(0);
  });

  test('auto-loads a replay from the ?replay query parameter', async ({ page }) => {
    await page.goto('/?replay=gen9ou-test-123');
    await expect(page.getByText('TestPlayer1', { exact: true }).first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('iframe[title="PS Replay"]')).toBeVisible({ timeout: 10000 });
  });

  test('embed mode hides the app chrome and waits for a host replay', async ({ page }) => {
    await page.goto('/?embed=1');
    await expect(page.getByText(/waiting for a replay/i)).toBeVisible();
    await expect(page.locator('h1')).toHaveCount(0);
  });

  test('embed mode loads replays posted by the host page', async ({ page }) => {
    await page.goto('/?embed=1');
    await expect(page.getByText(/waiting for a replay/i)).toBeVisible();
    await page.evaluate(() => window.postMessage({ type: 'ps-load-replay', replay: 'gen9ou-test-123' }, '*'));

    await expect(page.getByText('TestPlayer1', { exact: true }).first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('iframe[title="PS Replay"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('h1')).toHaveCount(0);
  });

  test('a replay injected while branching replaces the branch cleanly', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    await startVariationAt(page, 1);
    await expect(page.getByText(/Branching · Turn/)).toBeVisible({ timeout: 15000 });

    await page.evaluate(() => window.postMessage({ type: 'ps-load-replay', replay: 'gen9doubles-test' }, '*'));

    await expect(page.getByText('Alice', { exact: true }).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/Branching · Turn/)).toHaveCount(0);
    await expect(page.locator('iframe[title="PS Replay"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.ps-branch-bar input[type="range"]')).toBeVisible();
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
    await page.route('https://data.pkmn.cc/**', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) }));
    await page.locator('input[aria-label="Load exported replay file"]')
      .setInputFiles(join(__dirname, 'fixtures', 'gpl-replay.html'));

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

  test('exports both sides and applies an imported set as manual data (Import/Export Sets)', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    await expect(page.getByText('TestPlayer1', { exact: true }).first()).toBeVisible({ timeout: 10000 });

    await page.locator('button', { hasText: 'Import/Export Sets' }).click();
    const dialog = page.getByRole('dialog', { name: 'Import / Export Sets' });
    await expect(dialog).toBeVisible();

    const textarea = dialog.locator('textarea');
    const exported = await textarea.inputValue();
    expect(exported).toContain('=== p1: TestPlayer1 ===');
    expect(exported).toContain('=== p2: TestPlayer2 ===');
    expect(exported).toContain('Garchomp');

    await textarea.fill('=== p1: TestPlayer1 ===\n\nGarchomp @ Choice Band\nAbility: Rough Skin\nAdamant Nature\n- Earthquake');
    await dialog.locator('button', { hasText: 'Import' }).click();

    await expect(page.locator('.ps-main-right')).toContainText('Choice Band');
  });

  test('imported sets persist per replay across reloads', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    await page.locator('button', { hasText: 'Import/Export Sets' }).click();
    const dialog = page.getByRole('dialog', { name: 'Import / Export Sets' });
    await dialog.locator('textarea')
      .fill('=== p1 ===\n\nGarchomp @ Choice Band\n- Earthquake');
    await dialog.locator('button', { hasText: 'Import' }).click();
    await expect(page.locator('.ps-main-right')).toContainText('Choice Band');

    await page.reload();
    await page.locator('button', { hasText: 'Load' }).click();
    await expect(page.locator('.ps-main-right')).toContainText('Choice Band', { timeout: 10000 });
  });

  test('team editor offers legal dropdown pools and validates moves', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    await expect(page.getByText('TestPlayer1', { exact: true }).first()).toBeVisible({ timeout: 10000 });
    await page.locator('button', { hasText: 'Edit Player' }).click();
    const editor = page.getByRole('dialog', { name: 'Edit Player Team' });
    const garchompCard = editor.locator('.ps-panel').filter({ hasText: 'Garchomp' }).first();

    // Ability is a select restricted to the species' real abilities.
    const abilitySelect = garchompCard.getByLabel('Garchomp ability');
    await expect(abilitySelect.locator('option', { hasText: 'Rough Skin' })).toHaveCount(1, { timeout: 10000 });
    await expect(abilitySelect.locator('option', { hasText: 'Sand Veil' })).toHaveCount(1);
    await expect(abilitySelect.locator('option', { hasText: 'Intimidate' })).toHaveCount(0);

    // Nature select carries the 25 natures.
    await garchompCard.getByLabel('Garchomp nature').selectOption('Adamant');

    // Illegal move is rejected; a legal one is picked by CLICKING the
    // combobox option — no Enter required.
    const moveInput = garchompCard.getByPlaceholder('Add move...');
    await garchompCard.getByLabel(/Remove .* from Garchomp/).first().click();
    await moveInput.fill('Spore');
    await expect(garchompCard.getByText('No matching option')).toBeVisible();
    await moveInput.press('Enter');
    await expect(garchompCard.getByRole('alert')).toContainText('not in Garchomp');
    await moveInput.fill('Flame');
    await garchompCard.getByRole('option', { name: 'Flamethrower' }).click();
    await expect(garchompCard).toContainText('Flamethrower');

    await editor.locator('button', { hasText: /^Save$/ }).click();
    await expect(page.locator('.ps-main-right')).toContainText('Flamethrower');
  });

  test('rejects an import without side headers', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    await page.locator('button', { hasText: 'Import/Export Sets' }).click();
    const dialog = page.getByRole('dialog', { name: 'Import / Export Sets' });
    await dialog.locator('textarea').fill('Garchomp @ Choice Band\n- Earthquake');
    await dialog.locator('button', { hasText: 'Import' }).click();
    await expect(dialog.getByRole('alert')).toContainText('=== p1');
  });

  test('branching can load a hypothetical move from the legal pool', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    // Variant B: the what-if controls live in the Advanced row — open it,
    // then loading the move rebuilds the sim with the choice pre-seeded.
    await page.locator('button', { hasText: 'Advanced' }).click();
    const p1Controls = page.locator('.ps-branch-side-column').first();
    const whatIf = p1Controls.getByLabel('Hypothetical move for P1');

    // Garchomp knows 3 moves — the hypothetical simply becomes the 4th.
    // Picking from the combobox popup fills the field without pressing Enter.
    await expect(whatIf).toBeVisible({ timeout: 15000 });
    await expect(p1Controls.getByLabel('Replaced move for P1')).toHaveCount(0);
    await whatIf.fill('Flamethr');
    await p1Controls.getByRole('option', { name: 'Flamethrower' }).click();
    await expect(whatIf).toHaveValue('Flamethrower');
    await p1Controls.locator('button', { hasText: 'Load move' }).click();

    // The branch rebuilds with the move in the set and pre-selected as pending.
    await expect(page.getByText(/Branching.*Turn/)).toBeVisible({ timeout: 15000 });
    await expect(p1Controls.locator('.ps-movebtn', { hasText: 'Flamethrower' })).toBeVisible({ timeout: 15000 });
    await expect(p1Controls).toContainText('[Flamethrower]');

    // Now the set is full — a second hypothetical must replace a chosen move.
    const whatIfAgain = p1Controls.getByLabel('Hypothetical move for P1');
    await whatIfAgain.fill('Fire Blast');
    await p1Controls.getByLabel('Replaced move for P1').selectOption({ label: 'Earthquake' });
    await p1Controls.locator('button', { hasText: 'Load move' }).click();

    await expect(p1Controls.locator('.ps-movebtn', { hasText: 'Fire Blast' })).toBeVisible({ timeout: 15000 });
    await expect(p1Controls).toContainText('[Fire Blast]');
    await expect(p1Controls.locator('.ps-movebtn', { hasText: 'Earthquake' })).toHaveCount(0);
  });

  test('landing screen explains the unified timeline workflow', async ({ page }) => {
    await expect(page.getByText('Find the decision point')).toBeVisible();
    await expect(page.getByText('Play a different move')).toBeVisible();
    await expect(page.getByText('Compare the lines')).toBeVisible();
  });

  test('loads a replay and shows match info', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    await expect(page.getByText('TestPlayer1', { exact: true }).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('TestPlayer2', { exact: true }).first()).toBeVisible();
    await expect(page.locator('text=[Gen 9] OU')).toBeVisible();
  });

  test('opens shared branch links as a replayable read-only branch', async ({ page }) => {
    const encoded = encodeBranchShare(sharedBranchPayload);
    await page.goto(`/#branch=${encoded}`);

    await expect(page.getByText('Shared Branch')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('iframe[title="Shared Branch Replay"]')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Turn 2: P1 move 1 / P2 move 2')).toBeVisible();

    await page.locator('button', { hasText: 'Load Original Replay' }).click();
    await expect(page.locator('iframe[title="PS Replay"]')).toBeVisible({ timeout: 10000 });
  });

  test('shows single replay iframe after loading', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    const iframe = page.locator('iframe[title="PS Replay"]');
    await expect(iframe).toBeVisible({ timeout: 10000 });
    await expect(page.locator('iframe')).toHaveCount(1);
  });

  test('the loader input reflects the loaded replay link', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    // The default draft link gives way to the canonical link of what loaded —
    // whichever path (typed URL, file, share link) brought the replay in.
    await expect(page.getByLabel('Replay URL or ID')).toHaveValue(
      `https://replay.pokemonshowdown.com/${fixtureReplay.id}`, { timeout: 10000 });
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

  test('a ?p2 replay link loads the p2 perspective', async ({ page }) => {
    await page.getByLabel('Replay URL or ID').fill('https://replay.pokemonshowdown.com/gen9ou-123?p2');
    await page.locator('button', { hasText: 'Load' }).click();
    const iframeHandle = await page.locator('iframe[title="PS Replay"]').elementHandle({ timeout: 10000 });
    const frame = await iframeHandle?.contentFrame();
    expect(frame).toBeTruthy();

    await expect.poll(async () => frame!.evaluate(() =>
      (window as ReplayWindow).Replays?.battle?.viewpointSwitched ?? false
    ), { timeout: 30_000 }).toBe(true);
    // The mirrored loader link keeps the perspective flag.
    await expect(page.getByLabel('Replay URL or ID')).toHaveValue(/\?p2$/);
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
    const draftReplay = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'draft-replay.json'), 'utf-8'));
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

  test('the loaded replay shows P1 and P2 move controls without any mode switch', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();

    await expect(page.getByText('P1', { exact: true }).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('P2', { exact: true }).first()).toBeVisible();
    // The basic view lists moves AND switches as compact chips — no tabs.
    await expect(page.locator('.ps-branch-side-column').first().locator('.ps-movebtn').first()).toBeVisible();
    await expect(page.locator('.ps-branch-side-column').first().locator('.ps-switchbtn').first()).toBeVisible();
  });

  test('always-on pickers show move buttons with type info', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    await expect(page.locator('.ps-movebtn').first()).toBeVisible({ timeout: 15000 });
    // Type and damage details live in the Advanced (full) picker.
    await page.locator('button', { hasText: 'Advanced' }).click();
    // Range history: shifted when spread inference started overlaying
    // damage-consistent EVs (51–60.9%), then again when the goodness-of-fit
    // forfeit rejected this synthetic log's hand-authored damage numbers —
    // no legal spread fits them, so the degenerate solve (Bold 0-Atk
    // Garchomp) falls back to the species default and Earthquake hits real.
    // The snapshot picker feeds the same guessed sets (nature/EV spread)
    // into the same calc, so the pinned range carries over unchanged.
    await expect(page.locator('.ps-movebtn', { hasText: 'Earthquake' })).toContainText('69.8% - 82.2%', { timeout: 10000 });
  });

  test('always-on pickers can pick moves without Smogon stats', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();

    const firstMove = page.locator('.ps-movebtn').first();
    await expect(firstMove).toBeVisible({ timeout: 15000 });
    await firstMove.click();

    // Pending chips read as notation: the bare move name, no raw command.
    await expect(page.locator('.ps-pending-choice').first()).toBeVisible({ timeout: 5000 });
  });

  test('always-on pickers accept custom move choices', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();

    // The free-choice dropdown lives in the Advanced row.
    await page.locator('button', { hasText: 'Advanced' }).click();
    const pickers = page.locator('select[aria-label^="Choice picker"]');
    await expect(pickers.first()).toBeVisible({ timeout: 15000 });
    await pickers.first().selectOption({ index: 1 });

    // Pending chips show the move identity as notation (B1).
    await expect(page.locator('.ps-pending-choice').first()).toBeVisible({ timeout: 5000 });
  });

  test('saving player edits refreshes the pickers and exposes EV controls', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    await expect(page.locator('.ps-movebtn').first()).toBeVisible({ timeout: 15000 });

    await page.locator('button', { hasText: 'Edit Player' }).click();
    const editor = page.getByRole('dialog', { name: 'Edit Player Team' });
    await expect(editor).toBeVisible();
    await expect(editor.getByLabel('Garchomp HP EVs')).toBeVisible();
    await editor.getByLabel('Garchomp HP EVs').fill('252');
    await editor.getByLabel('Garchomp Atk EVs').fill('252');
    await editor.getByLabel('Garchomp Spe EVs').fill('4');
    const garchompCard = editor.locator('.ps-panel').filter({ hasText: 'Garchomp' }).first();
    await garchompCard.getByLabel(/Remove .* from Garchomp/).first().click();
    await garchompCard.getByPlaceholder('Add move...').fill('Dragon Claw');
    await garchompCard.getByPlaceholder('Add move...').press('Enter');
    await editor.locator('button', { hasText: /^Save$/ }).click();

    await expect(page.locator('.ps-branch-side-column').first()).toContainText('Dragon Claw', { timeout: 15000 });
    await expect(page.locator('.ps-main-right')).toContainText('252 HP / 252 Atk / 4 Spe EVs');

    await page.locator('button', { hasText: 'Edit Player' }).click();
    const reopenedEditor = page.getByRole('dialog', { name: 'Edit Player Team' });
    await expect(reopenedEditor.getByLabel('Garchomp HP EVs')).toHaveValue('252');
  });

  test('saving player edits mid-branch preserves branch progress and pending choices', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    const p1Controls = page.locator('.ps-branch-side-column').first();
    const p2Controls = page.locator('.ps-branch-side-column').nth(1);
    await startVariationAt(page, 1, { p1Move: 'Swords Dance' });
    await expect(page.getByText(/Branching · Turn 2/)).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.ps-panel', { hasText: 'Variation moves' })).toContainText('Turn 1');

    await p2Controls.locator('.ps-movebtn').first().click();
    // Pending chips show the move identity instead of the grid slot (B1).
    await expect(p2Controls.locator('.ps-pending-choice')).toBeVisible();

    await page.locator('button', { hasText: 'Edit Player' }).click();
    const editor = page.getByRole('dialog', { name: 'Edit Player Team' });
    const garchompCard = editor.locator('.ps-panel').filter({ hasText: 'Garchomp' }).first();
    await garchompCard.getByLabel('Remove Earthquake from Garchomp').click();
    await garchompCard.getByPlaceholder('Add move...').fill('Stone Edge');
    await garchompCard.getByPlaceholder('Add move...').press('Enter');
    await editor.locator('button', { hasText: /^Save$/ }).click();

    await expect(page.getByText(/Branching.*Turn 2/)).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.ps-panel', { hasText: 'Variation moves' })).toContainText('Turn 1');
    await expect(p1Controls).toContainText('Stone Edge');
    await expect(p1Controls).not.toContainText('Earthquake');
    await expect(p2Controls.locator('.ps-pending-choice')).toBeVisible();

    await p1Controls.locator('.ps-movebtn', { hasText: 'Stone Edge' }).click();
    await expect(page.locator('button', { hasText: 'Execute Turn' })).toBeEnabled();
  });

  test('snapshot pickers upgrade to the exact position on dwell — no button', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    // The approximation renders first (PP unknown = dash) …
    await expect(page.getByText(/Choices approximated/)).toBeVisible({ timeout: 15000 });
    await expect(page.locator('button', { hasText: 'Rebuild exact position' })).toHaveCount(0);
    // … and after settling, the background reconstruction upgrades it in
    // place: real PP appears and the source line says so.
    await expect(page.getByText('Choices from the reconstructed position')).toBeVisible({ timeout: 90_000 });
    await expect(page.locator('.ps-movebtn-pp').first()).toHaveText(/\d+\/\d+/);
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

  test('compact move chips grow into full move buttons in Advanced', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    await expect(page.locator('.ps-movebtn').first()).toBeVisible({ timeout: 15000 });

    // Basic: small action chips to save space.
    const chipBox = await page.locator('.ps-movebtn').first().boundingBox();
    expect(chipBox?.height).toBeLessThanOrEqual(40);

    // Advanced: the full readable move buttons with type and damage info.
    await page.locator('button', { hasText: 'Advanced' }).click();
    await expect(page.locator('.ps-movebtn-info').first()).toBeVisible({ timeout: 5000 });
    const box = await page.locator('.ps-movebtn').first().boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(58);
    expect(box?.width).toBeGreaterThanOrEqual(120);
  });

  test('switch options show as chips in basic and behind the Pokémon tab in Advanced', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    // Basic: switch chips sit right next to the move chips.
    await expect(page.locator('.ps-switchbtn').first()).toBeVisible({ timeout: 15000 });

    // Advanced: the full picker keeps the Fight/Pokémon tabs.
    await page.locator('button', { hasText: 'Advanced' }).click();
    await expect(page.locator('button', { hasText: 'Pokémon' }).first()).toBeVisible({ timeout: 5000 });
    await page.locator('button', { hasText: 'Pokémon' }).first().click();
    await expect(page.locator('.ps-switchbtn').first()).toBeVisible({ timeout: 5000 });
  });

  test('selecting moves for both sides enables Execute Turn', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();

    const moveBtns = page.locator('.ps-movebtn');
    await expect(moveBtns.first()).toBeVisible({ timeout: 15000 });

    const allMoveBtns = await moveBtns.all();
    if (allMoveBtns.length >= 2) {
      await allMoveBtns[0].click();
      const p2Moves = page.locator('.ps-movegrid').nth(1).locator('.ps-movebtn');
      await p2Moves.first().click();

      const execBtn = page.locator('button', { hasText: 'Execute Turn' });
      await expect(execBtn).toBeVisible({ timeout: 5000 });
      await expect(execBtn).toBeEnabled();
    }
  });

  test('an open variation exposes save and share controls', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    await startVariationAt(page, 1);

    await expect(page.locator('button', { hasText: 'Save Branch' })).toBeVisible({ timeout: 5000 });
    await page.locator('button', { hasText: 'Copy Share Link' }).click();
    await expect(page.locator('input[aria-label="Branch share link"]')).toHaveValue(/#branch=/);
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

  test('doubles branch shows slot controls and blocks duplicate simultaneous switches', async ({ page }) => {
    await page.locator('input[type="text"]').fill('gen9doubles-test');
    await page.locator('button', { hasText: 'Load' }).click();
    await expect(page.getByText('Alice', { exact: true }).first()).toBeVisible({ timeout: 10000 });
    // Doubles targeting needs the real request — the dwell upgrade delivers it.
    await waitForExactPickers(page);

    const controls = page.locator('.ps-side-controls');
    await expect(controls).toHaveCount(4);
    await expect(controls.nth(0)).toContainText('P1A');
    await expect(controls.nth(1)).toContainText('P1B');
    await expect(controls.nth(2)).toContainText('P2A');
    await expect(controls.nth(3)).toContainText('P2B');

    // The compact picker lists switch chips per slot without a tab switch.
    await expect(controls.nth(0).locator('.ps-switchbtn').first()).toBeVisible({ timeout: 5000 });
    await expect(controls.nth(1).locator('.ps-switchbtn').first()).toBeVisible();

    await controls.nth(0).locator('.ps-switchbtn').first().click();
    await expect(controls.nth(1).locator('.ps-switchbtn').first()).toBeDisabled();
  });

  test('doubles target buttons identify and highlight the selected target', async ({ page }) => {
    await page.locator('input[type="text"]').fill('gen9doubles-test');
    await page.locator('button', { hasText: 'Load' }).click();
    await expect(page.getByText('Alice', { exact: true }).first()).toBeVisible({ timeout: 10000 });
    // Doubles targeting needs the real request — the dwell upgrade delivers it.
    await waitForExactPickers(page);

    const pikachuControls = page.locator('.ps-side-controls').first();
    const bulbasaurTarget = pikachuControls.locator('.ps-target-btn[title^="Thunderbolt into Bulbasaur"]');
    const charmanderTarget = pikachuControls.locator('.ps-target-btn[title^="Thunderbolt into Charmander"]');
    await expect(bulbasaurTarget).toBeVisible();
    await expect(charmanderTarget).toBeVisible();
    await expect(bulbasaurTarget).toContainText('P2A Bulbasaur');
    await expect(charmanderTarget).toContainText('P2B Charmander');

    await charmanderTarget.click();
    await expect(charmanderTarget).toHaveClass(/ps-target-btn-selected/);
    await expect(pikachuControls).toContainText('Targeting P2B Charmander');
    await expect(bulbasaurTarget).not.toHaveClass(/ps-target-btn-selected/);
  });

  test('Discard variation drops the variation and returns to the replay', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    await startVariationAt(page, 1);

    await page.locator('button', { hasText: 'Discard variation' }).click();
    await expect(page.getByText(/Branching · Turn/)).toHaveCount(0);
    await expect(page.locator('iframe[title="PS Replay"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.ps-branch-bar input[type="range"]')).toBeVisible();
  });

  test('team paste section is available', async ({ page }) => {
    const details = page.locator('details');
    await expect(details).toBeVisible();
    await details.locator('summary').click();
    await expect(page.locator('textarea')).toBeVisible();
    await expect(page.locator('button', { hasText: 'Save Team' })).toBeVisible();
  });

  test('Edit Opp button appears after loading replay', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    await expect(page.locator('button', { hasText: 'Edit Opp' })).toBeVisible({ timeout: 10000 });
  });

  test('Battle Statistics panel appears after loading replay', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    await expect(page.locator('text=Battle Statistics')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.ps-stats-team')).toHaveCount(2);
    await expect(page.locator('.ps-stats-pokemon').first()).toBeVisible();
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
