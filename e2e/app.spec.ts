import { test, expect } from '@playwright/test';
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

test.describe('PS Replay Interceptor', () => {
  test.beforeEach(async ({ page }) => {
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
    await expect(page.locator('h1')).toHaveText('PS Replay Interceptor');
  });

  test('shows replay loader with URL input and load button', async ({ page }) => {
    const input = page.locator('input[type="text"]');
    await expect(input).toBeVisible();
    await expect(input).toHaveValue(/replay\.pokemonshowdown\.com/);
    await expect(page.locator('button', { hasText: 'Load' })).toBeVisible();
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
    await expect.poll(async () => frame!.evaluate(() => (window as ReplayWindow).Replays?.battle?.turn ?? -1)).toBe(2);
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
    await expect.poll(async () => frame!.evaluate(() => (window as ReplayWindow).Replays?.battle?.turn ?? -1)).toBe(2);
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

    const customInputs = page.locator('input[aria-label^="Custom move choice"]');
    await expect(customInputs.first()).toBeVisible({ timeout: 5000 });
    await customInputs.first().fill('move 1');
    await page.locator('button', { hasText: 'Use Custom' }).first().click();

    await expect(page.locator('text=/\\[move 1\\]/').first()).toBeVisible({ timeout: 5000 });
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

    await page.locator('button', { hasText: /Use Recommended/i }).nth(0).click();
    await page.locator('button', { hasText: /Use Recommended/i }).nth(1).click();
    await page.locator('button', { hasText: 'Execute Turn' }).click();
    await expect(page.getByText(/Branching.*Turn 2/)).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.ps-panel', { hasText: 'Branch History' })).toContainText('Turn 1');

    const p2Controls = page.locator('.ps-branch-side-column').nth(1);
    await page.locator('button', { hasText: /Use Recommended/i }).nth(1).click();
    await expect(p2Controls).toContainText(/\[move \d+\]/);

    await page.locator('button', { hasText: 'Edit Player' }).click();
    const editor = page.getByRole('dialog', { name: 'Edit Player Team' });
    const garchompCard = editor.locator('.ps-panel').filter({ hasText: 'Garchomp' }).first();
    await garchompCard.getByLabel('Remove Earthquake from Garchomp').click();
    await garchompCard.getByPlaceholder('Add move...').fill('Brave Bird');
    await garchompCard.getByPlaceholder('Add move...').press('Enter');
    await editor.locator('button', { hasText: /^Save$/ }).click();

    const p1Controls = page.locator('.ps-branch-side-column').first();
    await expect(page.getByText(/Branching.*Turn 2/)).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.ps-panel', { hasText: 'Branch History' })).toContainText('Turn 1');
    await expect(p1Controls).toContainText('Brave Bird');
    await expect(p1Controls).not.toContainText('Earthquake');
    await expect(p2Controls).toContainText(/\[move \d+\]/);

    await p1Controls.locator('.ps-movebtn', { hasText: 'Brave Bird' }).click();
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
    await expect.poll(async () => frame!.evaluate(() => (window as ReplayWindow).Replays?.battle?.turn ?? -1)).toBe(2);

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
    await expect.poll(async () => frame!.evaluate(() =>
      (window as ReplayWindow).Replays?.battle?.turn ?? -1
    )).toBe(2);
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
    await expect.poll(async () => frame!.evaluate(() => (window as ReplayWindow).Replays?.battle?.turn ?? -1)).toBe(2);

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

    for (let i = 0; i < 2; i++) {
      const recs = page.locator('button', { hasText: /Use Recommended/i });
      await recs.nth(0).click();
      await recs.nth(1).click();
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
