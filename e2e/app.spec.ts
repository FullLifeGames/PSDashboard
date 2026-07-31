import { test, expect, type Frame } from '@playwright/test';
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

test.describe('PS Dashboard', () => {
  test.beforeEach(async ({ page }) => {
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
      const replay = route.request().url().includes(doublesReplay.id) ? doublesReplay : fixtureReplay;
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(replay),
      });
    });
    await page.route('https://data.pkmn.cc/**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({}),
      });
    });
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
    await expect(page.locator('button', { hasText: 'Branch Here' })).toBeVisible();
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
    await page.locator('button', { hasText: 'Branch Here' }).click();
    await expect(page.getByText(/Branching.*Turn/)).toBeVisible({ timeout: 15000 });

    await page.evaluate(() => window.postMessage({ type: 'ps-load-replay', replay: 'gen9doubles-test' }, '*'));

    await expect(page.getByText('Alice', { exact: true }).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/Branching/)).toHaveCount(0);
    await expect(page.locator('iframe[title="PS Replay"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('button', { hasText: 'Branch Here' })).toBeVisible();
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

    await page.locator('button', { hasText: 'Eval' }).click();
    // The panel lives beside the battle in the right column (chess-style).
    const panel = page.locator('.ps-main-right .ps-eval-panel');
    await expect(panel).toBeVisible();
    // Reconstruction + search on the small fixture replay.
    await panel.locator('button', { hasText: 'Evaluate' }).click();
    await expect(panel.locator('.ps-eval-bar')).toBeVisible({ timeout: 120_000 });
    await expect(panel.locator('.ps-eval-bar-p1')).toContainText('%');
    expect(await panel.locator('.ps-eval-column').count()).toBe(2);
    await expect(panel.getByText(/worst vs/).first()).toBeVisible();
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

    await page.locator('button', { hasText: 'Eval' }).click();
    const panel = page.locator('.ps-main-right .ps-eval-panel');
    await expect(panel.locator('select').first()).toHaveValue('mcts');
    await panel.locator('button', { hasText: 'Evaluate' }).click();
    await expect(panel.locator('.ps-eval-bar')).toBeVisible({ timeout: 120_000 });
    await expect(panel.locator('.ps-eval-bar-p1')).toContainText('%');
  });

  test('analyzes the whole game into an eval graph', async ({ page }) => {
    test.setTimeout(240_000);
    await page.evaluate(() => {
      localStorage.setItem('ps-replay-interceptor:eval-pool', '2');
      localStorage.setItem('ps-replay-interceptor:eval-prefs',
        JSON.stringify({ depth: 1, samples: 1, auto: false, tera: 'auto' }));
    });
    await page.reload();
    await page.locator('button', { hasText: 'Load' }).click();
    await expect(page.getByText('TestPlayer1', { exact: true }).first()).toBeVisible({ timeout: 10000 });

    await page.locator('button', { hasText: 'Eval' }).click();
    const panel = page.locator('.ps-main-right .ps-eval-panel');
    await panel.locator('button', { hasText: 'Analyze game' }).click();
    await expect(panel.locator('.ps-eval-graph')).toBeVisible({ timeout: 180_000 });
    expect(await panel.locator('.ps-eval-graph circle').count()).toBeGreaterThan(0);
    // The sweep finishes and offers a re-run.
    await expect(panel.locator('button', { hasText: 'Re-analyze' })).toBeVisible({ timeout: 60_000 });
  });

  test('branch mode: picking both recommendations arms Execute Turn', async ({ page }) => {
    test.setTimeout(180_000);
    await page.evaluate(() => {
      localStorage.setItem('ps-replay-interceptor:eval-pool', '2');
      localStorage.setItem('ps-replay-interceptor:eval-prefs',
        JSON.stringify({ depth: 1, samples: 1, auto: false, tera: 'auto' }));
    });
    await page.reload();
    await page.locator('button', { hasText: 'Load' }).click();
    await page.locator('button', { hasText: 'Branch Here' }).click();
    await expect(page.getByText(/Branching.*Turn/)).toBeVisible({ timeout: 15000 });

    await page.locator('button', { hasText: 'Eval' }).click();
    const panel = page.locator('.ps-eval-panel');
    await panel.locator('button', { hasText: 'Evaluate' }).click();
    await expect(panel.locator('.ps-eval-bar')).toBeVisible({ timeout: 120_000 });

    await panel.locator('.ps-eval-column').nth(0).locator('.ps-eval-choice').first().click();
    await panel.locator('.ps-eval-column').nth(1).locator('.ps-eval-choice').first().click();
    await expect(page.locator('button', { hasText: 'Execute Turn' })).toBeEnabled();
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
    await page.locator('button', { hasText: 'Branch Here' }).click();
    await expect(page.getByText(/Branching.*Turn/)).toBeVisible({ timeout: 15000 });

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
    await expect(p1Controls).toContainText('[move Flamethrower]');

    // Now the set is full — a second hypothetical must replace a chosen move.
    const whatIfAgain = p1Controls.getByLabel('Hypothetical move for P1');
    await whatIfAgain.fill('Fire Blast');
    await p1Controls.getByLabel('Replaced move for P1').selectOption({ label: 'Earthquake' });
    await p1Controls.locator('button', { hasText: 'Load move' }).click();

    await expect(p1Controls.locator('.ps-movebtn', { hasText: 'Fire Blast' })).toBeVisible({ timeout: 15000 });
    await expect(p1Controls).toContainText('[move Fire Blast]');
    await expect(p1Controls.locator('.ps-movebtn', { hasText: 'Earthquake' })).toHaveCount(0);
  });

  test('landing screen explains the replay branching workflow', async ({ page }) => {
    await expect(page.getByText('Pick a branch turn')).toBeVisible();
    await expect(page.getByText('Choose both sides')).toBeVisible();
    await expect(page.getByText('Compare outcomes')).toBeVisible();
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

  test('shows branch bar with slider and Branch Here button', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    await expect(page.locator('input[type="range"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('button', { hasText: 'Branch Here' })).toBeVisible();
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

  test('replay iframe keeps a fixed visible height without negative offset', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    const iframe = page.locator('iframe[title="PS Replay"]');
    await expect(iframe).toBeVisible({ timeout: 10000 });
    await expect(iframe).toHaveCSS('height', '480px');
    await expect(iframe).toHaveCSS('margin-top', '0px');
  });

  test('branch replay iframe keeps the same fixed visible height', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    await page.locator('button', { hasText: 'Branch Here' }).click();
    await expect(page.getByText(/Branching.*Turn/)).toBeVisible({ timeout: 15000 });

    const branchIframe = page.locator('iframe[title="Branch Simulation"]');
    await expect(branchIframe).toBeVisible({ timeout: 10000 });
    await expect(branchIframe).toHaveCSS('height', '480px');
    await expect(branchIframe).toHaveCSS('margin-top', '0px');
    await expect(page.locator('iframe')).toHaveCount(1);
  });

  test('branching starts from the selected slider turn', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    await page.locator('input[type="range"]').fill('2');
    await expect(page.getByText('T2/')).toBeVisible();
    await page.locator('button', { hasText: 'Branch Here' }).click();

    await expect(page.getByText(/Branching.*Turn 2/)).toBeVisible({ timeout: 15000 });
  });

  test('branch replay viewer starts on the selected turn', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    await page.locator('input[type="range"]').fill('2');
    await page.locator('button', { hasText: 'Branch Here' }).click();
    await expect(page.getByText(/Branching.*Turn 2/)).toBeVisible({ timeout: 15000 });

    const iframeHandle = await page.locator('iframe[title="Branch Simulation"]').elementHandle({ timeout: 10000 });
    const frame = await iframeHandle?.contentFrame();
    expect(frame).toBeTruthy();
    await expectReplayTurn(frame!, 2);
  });

  test('clicking Branch Here replaces replay with branch sim', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    await expect(page.locator('button', { hasText: 'Branch Here' })).toBeVisible({ timeout: 10000 });
    await page.locator('button', { hasText: 'Branch Here' }).click();

    await expect(page.getByText(/Branching.*Turn/)).toBeVisible({ timeout: 15000 });
    await expect(page.locator('button', { hasText: 'Back' })).toBeVisible();

    await expect(page.locator('iframe[title="Branch Simulation"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('iframe')).toHaveCount(1);
  });

  test('branching shows P1 and P2 move controls', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    await expect(page.locator('button', { hasText: 'Branch Here' })).toBeVisible({ timeout: 10000 });
    await page.locator('button', { hasText: 'Branch Here' }).click();

    await expect(page.getByText(/Branching.*Turn/)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('P1', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('P2', { exact: true }).first()).toBeVisible();
    await expect(page.locator('button', { hasText: 'Fight' }).first()).toBeVisible();
  });

  test('branch simulation shows move buttons with type info', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    await expect(page.locator('button', { hasText: 'Branch Here' })).toBeVisible({ timeout: 10000 });
    await page.locator('button', { hasText: 'Branch Here' }).click();
    await expect(page.getByText(/Branching.*Turn/)).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.ps-movebtn').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.ps-movebtn', { hasText: 'Earthquake' })).toContainText('69.8% - 82.2%', { timeout: 10000 });
  });

  test('branch simulation can pick recommended moves without Smogon stats', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    await expect(page.locator('button', { hasText: 'Branch Here' })).toBeVisible({ timeout: 10000 });
    await page.locator('button', { hasText: 'Branch Here' }).click();
    await expect(page.getByText(/Branching.*Turn/)).toBeVisible({ timeout: 15000 });

    const recommendation = page.locator('button', { hasText: /Use Recommended/i }).first();
    await expect(recommendation).toBeVisible({ timeout: 5000 });
    await recommendation.click();

    await expect(page.locator('text=/\\[move /').first()).toBeVisible({ timeout: 5000 });
  });

  test('branch simulation accepts custom move choices', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    await page.locator('button', { hasText: 'Branch Here' }).click();
    await expect(page.getByText(/Branching.*Turn/)).toBeVisible({ timeout: 15000 });

    const pickers = page.locator('select[aria-label^="Choice picker"]');
    await expect(pickers.first()).toBeVisible({ timeout: 5000 });
    await pickers.first().selectOption({ index: 1 });

    // Pending chips now show the move identity instead of the grid slot (B1).
    await expect(page.locator('text=/\\[move .+\\]/').first()).toBeVisible({ timeout: 5000 });
  });

  test('saving player edits refreshes the active branch and exposes EV controls', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    await page.locator('button', { hasText: 'Branch Here' }).click();
    await expect(page.getByText(/Branching.*Turn/)).toBeVisible({ timeout: 15000 });

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
    await page.locator('button', { hasText: 'Branch Here' }).click();
    await expect(page.getByText(/Branching.*Turn 1/)).toBeVisible({ timeout: 15000 });

    const p1Controls = page.locator('.ps-branch-side-column').first();
    const p2Controls = page.locator('.ps-branch-side-column').nth(1);
    await p1Controls.locator('.ps-movebtn', { hasText: 'Swords Dance' }).click();
    await p2Controls.locator('button', { hasText: /Use Recommended/i }).click();
    await page.locator('button', { hasText: 'Execute Turn' }).click();
    await expect(page.getByText(/Branching.*Turn 2/)).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.ps-panel', { hasText: 'Branch History' })).toContainText('Turn 1');

    await page.locator('button', { hasText: /Use Recommended/i }).nth(1).click();
    // Pending chips show the move identity instead of the grid slot (B1).
    await expect(p2Controls).toContainText(/\[move .+\]/);

    await page.locator('button', { hasText: 'Edit Player' }).click();
    const editor = page.getByRole('dialog', { name: 'Edit Player Team' });
    const garchompCard = editor.locator('.ps-panel').filter({ hasText: 'Garchomp' }).first();
    await garchompCard.getByLabel('Remove Earthquake from Garchomp').click();
    await garchompCard.getByPlaceholder('Add move...').fill('Stone Edge');
    await garchompCard.getByPlaceholder('Add move...').press('Enter');
    await editor.locator('button', { hasText: /^Save$/ }).click();

    await expect(page.getByText(/Branching.*Turn 2/)).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.ps-panel', { hasText: 'Branch History' })).toContainText('Turn 1');
    await expect(p1Controls).toContainText('Stone Edge');
    await expect(p1Controls).not.toContainText('Earthquake');
    await expect(p2Controls).toContainText(/\[move .+\]/);

    await p1Controls.locator('.ps-movebtn', { hasText: 'Stone Edge' }).click();
    await expect(page.locator('button', { hasText: 'Execute Turn' })).toBeEnabled();
  });

  test('clicking Branch Here gives immediate preparation feedback', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    await expect(page.locator('button', { hasText: 'Branch Here' })).toBeVisible({ timeout: 10000 });
    await page.locator('button', { hasText: 'Branch Here' }).click();
    await expect(page.getByText('Preparing branch...')).toBeVisible({ timeout: 1000 });
  });

  test('executing a branch turn keeps the branch replay iframe mounted', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    await page.locator('button', { hasText: 'Branch Here' }).click();
    await expect(page.getByText(/Branching.*Turn/)).toBeVisible({ timeout: 15000 });

    await page.locator('button', { hasText: /Use Recommended/i }).nth(0).click();
    await page.locator('button', { hasText: /Use Recommended/i }).nth(1).click();
    const iframe = await page.locator('iframe[title="Branch Simulation"]').elementHandle();
    await page.locator('button', { hasText: 'Execute Turn' }).click();

    await expect(page.getByText(/Branching.*Turn/)).toBeVisible({ timeout: 10000 });
    const sameIframe = await page.locator('iframe[title="Branch Simulation"]').evaluate((el, previous) => el === previous, iframe);
    expect(sameIframe).toBe(true);
  });

  test('branch replay follows appended branch events and keeps iframe turn controls usable', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    await expect(page.locator('button', { hasText: 'Branch Here' })).toBeVisible({ timeout: 10000 });
    await expect(page.locator('iframe[title="PS Replay"]')).toBeVisible({ timeout: 10000 });
    const branchBar = page.locator('.ps-branch-bar');
    await branchBar.locator('input[type="range"]').fill('2');
    await branchBar.locator('button', { hasText: 'Branch Here' }).evaluate((button: HTMLElement) => button.click());
    await expect(page.getByText(/Branching.*Turn 2/)).toBeVisible({ timeout: 15000 });

    const iframeHandle = await page.locator('iframe[title="Branch Simulation"]').elementHandle({ timeout: 10000 });
    const frame = await iframeHandle?.contentFrame();
    expect(frame).toBeTruthy();
    await expectReplayTurn(frame!, 2);

    await page.locator('button', { hasText: /Use Recommended/i }).nth(0).click();
    await page.locator('button', { hasText: /Use Recommended/i }).nth(1).click();
    await page.locator('button', { hasText: 'Execute Turn' }).click();

    await expect.poll(async () =>
      frame!.evaluate(() => document.querySelector('.battle-log')?.textContent ?? '')
    ).toContain('The opposing Kingambit fainted!');
    await expect.poll(async () =>
      frame!.evaluate(() => (document.querySelector('.battle-log')?.textContent ?? '').match(/Battle started/g)?.length ?? 0)
    ).toBe(1);

    await frame!.locator('button', { hasText: 'Last turn' }).click();
    await expect.poll(async () =>
      frame!.evaluate(() => document.querySelector('.battle-log')?.textContent ?? '')
    ).not.toContain('The opposing Kingambit fainted!');

    await frame!.locator('button', { hasText: 'Next turn' }).click();
    await frame!.locator('button', { hasText: 'Next turn' }).click();
    await expect.poll(async () =>
      frame!.evaluate(() => document.querySelector('.battle-log')?.textContent ?? '')
    ).toContain('The opposing Kingambit fainted!');
  });

  test('branch execution defaults to animating the appended turn', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    await expect(page.locator('button', { hasText: 'Branch Here' })).toBeVisible({ timeout: 10000 });
    await page.locator('input[type="range"]').fill('2');
    await page.locator('button', { hasText: 'Branch Here' }).click();
    await expect(page.getByText(/Branching.*Turn 2/)).toBeVisible({ timeout: 15000 });

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

    await page.locator('button', { hasText: /Use Recommended/i }).nth(0).click();
    await page.locator('button', { hasText: /Use Recommended/i }).nth(1).click();
    await page.locator('button', { hasText: 'Execute Turn' }).click();

    await expect.poll(async () => frame!.evaluate(() =>
      (window as ReplayWindow).__psPostedMessages?.some(message => {
        const data = message as { type?: string; playFromTurn?: number };
        return data.type === 'ps-append-log' && data.playFromTurn === 2;
      }) ?? false
    )).toBe(true);
    await expectReplayTurn(frame!, 2);
  });

  test('branch replay play controls stay muted without audio errors', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.locator('button', { hasText: 'Load' }).click();
    await expect(page.locator('button', { hasText: 'Branch Here' })).toBeVisible({ timeout: 10000 });
    await expect(page.locator('iframe[title="PS Replay"]')).toBeVisible({ timeout: 10000 });
    const branchBar = page.locator('.ps-branch-bar');
    await branchBar.locator('input[type="range"]').fill('2');
    await branchBar.locator('button', { hasText: 'Branch Here' }).evaluate((button: HTMLElement) => button.click());
    await expect(page.getByText(/Branching.*Turn 2/)).toBeVisible({ timeout: 15000 });

    const iframeHandle = await page.locator('iframe[title="Branch Simulation"]').elementHandle({ timeout: 10000 });
    const frame = await iframeHandle?.contentFrame();
    expect(frame).toBeTruthy();
    await expectReplayTurn(frame!, 2);

    await frame!.locator('button', { hasText: 'Play' }).click();
    await expect.poll(async () =>
      frame!.evaluate(() => Boolean((window as ReplayWindow).Replays?.battle && !(window as ReplayWindow).Replays?.battle?.paused))
    ).toBe(true);
    expect(pageErrors).toHaveLength(0);
  });

  test('branch replay iframe does not shrink as history grows', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    await page.locator('button', { hasText: 'Branch Here' }).click();
    await expect(page.getByText(/Branching.*Turn/)).toBeVisible({ timeout: 15000 });

    const branchIframe = page.locator('iframe[title="Branch Simulation"]');
    const initialBox = await branchIframe.boundingBox();

    // P1 clicks Swords Dance instead of the recommendation — a recommended
    // Earthquake can crit-KO Kingambit on turn 1, which turns P2's controls
    // into a forced-switch prompt and strands the second Use Recommended wait.
    const p1Controls = page.locator('.ps-branch-side-column').first();
    const p2Controls = page.locator('.ps-branch-side-column').nth(1);
    for (let i = 0; i < 2; i++) {
      await p1Controls.locator('.ps-movebtn', { hasText: 'Swords Dance' }).click();
      await p2Controls.locator('button', { hasText: /Use Recommended/i }).click();
      await page.locator('button', { hasText: 'Execute Turn' }).click();
      await expect(page.locator('.ps-panel', { hasText: 'Branch History' })).toContainText(`Turn ${i + 1}`, { timeout: 10000 });
    }

    const finalBox = await branchIframe.boundingBox();
    expect(finalBox?.height).toBe(initialBox?.height);
    await expect(branchIframe).toHaveCSS('height', '480px');
  });

  test('desktop branch controls keep both sides and Execute Turn in the first viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('button', { hasText: 'Load' }).click();
    await page.locator('input[type="range"]').fill('2');
    await page.locator('button', { hasText: 'Branch Here' }).click();
    await expect(page.getByText(/Branching.*Turn/)).toBeVisible({ timeout: 15000 });

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
    await page.locator('button', { hasText: 'Branch Here' }).click();
    await expect(page.getByText(/Branching.*Turn/)).toBeVisible({ timeout: 15000 });

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

  test('move buttons keep a readable fixed size', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    await page.locator('button', { hasText: 'Branch Here' }).click();
    await expect(page.getByText(/Branching.*Turn/)).toBeVisible({ timeout: 15000 });

    const box = await page.locator('.ps-movebtn').first().boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(58);
    expect(box?.width).toBeGreaterThanOrEqual(120);
  });

  test('can switch to Pokémon tab to see switch options', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    await expect(page.locator('button', { hasText: 'Branch Here' })).toBeVisible({ timeout: 10000 });
    await page.locator('button', { hasText: 'Branch Here' }).click();
    await expect(page.getByText(/Branching.*Turn/)).toBeVisible({ timeout: 15000 });

    await page.locator('button', { hasText: 'Pokémon' }).first().click();
    await expect(page.locator('.ps-switchbtn').first()).toBeVisible({ timeout: 5000 });
  });

  test('selecting moves for both sides enables Execute Turn', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    await expect(page.locator('button', { hasText: 'Branch Here' })).toBeVisible({ timeout: 10000 });
    await page.locator('button', { hasText: 'Branch Here' }).click();
    await expect(page.getByText(/Branching.*Turn/)).toBeVisible({ timeout: 15000 });

    const moveBtns = page.locator('.ps-movebtn');
    await expect(moveBtns.first()).toBeVisible({ timeout: 5000 });

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

  test('branch mode exposes save and share controls', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    await expect(page.locator('button', { hasText: 'Branch Here' })).toBeVisible({ timeout: 10000 });
    await page.locator('button', { hasText: 'Branch Here' }).click();
    await expect(page.getByText(/Branching.*Turn/)).toBeVisible({ timeout: 15000 });

    await expect(page.locator('button', { hasText: 'Save Branch' })).toBeVisible({ timeout: 5000 });
    await page.locator('button', { hasText: 'Copy Share Link' }).click();
    await expect(page.locator('input[aria-label="Branch share link"]')).toHaveValue(/#branch=/);
  });

  test('doubles branch shows slot controls and blocks duplicate simultaneous switches', async ({ page }) => {
    await page.locator('input[type="text"]').fill('gen9doubles-test');
    await page.locator('button', { hasText: 'Load' }).click();
    await expect(page.getByText('Alice', { exact: true }).first()).toBeVisible({ timeout: 10000 });
    await page.locator('button', { hasText: 'Branch Here' }).click();
    await expect(page.getByText(/Branching.*Turn/)).toBeVisible({ timeout: 15000 });

    const controls = page.locator('.ps-side-controls');
    await expect(controls).toHaveCount(4);
    await expect(controls.nth(0)).toContainText('P1A');
    await expect(controls.nth(1)).toContainText('P1B');
    await expect(controls.nth(2)).toContainText('P2A');
    await expect(controls.nth(3)).toContainText('P2B');

    await controls.nth(0).locator('.ps-controls-tab').nth(1).click();
    await controls.nth(1).locator('.ps-controls-tab').nth(1).click();
    await expect(controls.nth(0).locator('.ps-switchbtn').first()).toBeVisible({ timeout: 5000 });
    await expect(controls.nth(1).locator('.ps-switchbtn').first()).toBeVisible();

    await controls.nth(0).locator('.ps-switchbtn').first().click();
    await expect(controls.nth(1).locator('.ps-switchbtn').first()).toBeDisabled();
  });

  test('doubles target buttons identify and highlight the selected target', async ({ page }) => {
    await page.locator('input[type="text"]').fill('gen9doubles-test');
    await page.locator('button', { hasText: 'Load' }).click();
    await expect(page.getByText('Alice', { exact: true }).first()).toBeVisible({ timeout: 10000 });
    await page.locator('button', { hasText: 'Branch Here' }).click();
    await expect(page.getByText(/Branching.*Turn/)).toBeVisible({ timeout: 15000 });

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

  test('Back button returns to original replay', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    await expect(page.locator('button', { hasText: 'Branch Here' })).toBeVisible({ timeout: 10000 });
    await page.locator('button', { hasText: 'Branch Here' }).click();
    await expect(page.getByText(/Branching.*Turn/)).toBeVisible({ timeout: 15000 });

    await page.locator('button', { hasText: 'Back' }).click();
    await expect(page.locator('button', { hasText: 'Branch Here' })).toBeVisible({ timeout: 5000 });
    await expect(page.locator('iframe[title="PS Replay"]')).toBeVisible();
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
});
