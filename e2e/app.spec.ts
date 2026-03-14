import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const fixtureReplay = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'replay.json'), 'utf-8'),
);

test.describe('PS Replay Interceptor', () => {
  test.beforeEach(async ({ page }) => {
    // Intercept replay fetch and return fixture data
    await page.route('**/replay.pokemonshowdown.com/**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(fixtureReplay),
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

    const loadBtn = page.locator('button', { hasText: 'Load' });
    await expect(loadBtn).toBeVisible();
  });

  test('loads a replay and shows match info', async ({ page }) => {
    const loadBtn = page.locator('button', { hasText: 'Load' });
    await loadBtn.click();

    await expect(page.getByText('TestPlayer1', { exact: true }).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('TestPlayer2', { exact: true }).first()).toBeVisible();
    await expect(page.locator('text=[Gen 9] OU')).toBeVisible();
  });

  test('shows single replay iframe after loading', async ({ page }) => {
    const loadBtn = page.locator('button', { hasText: 'Load' });
    await loadBtn.click();

    const iframe = page.locator('iframe[title="PS Replay"]');
    await expect(iframe).toBeVisible({ timeout: 10000 });

    // Only one iframe should exist before branching
    const iframes = page.locator('iframe');
    await expect(iframes).toHaveCount(1);
  });

  test('shows branch point controls with slider and Branch Here button', async ({ page }) => {
    const loadBtn = page.locator('button', { hasText: 'Load' });
    await loadBtn.click();

    await expect(page.locator('text=Branch Point')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('input[type="range"]')).toBeVisible();
    await expect(page.locator('button', { hasText: 'Branch Here' })).toBeVisible();
  });

  test('branch turn slider updates turn display', async ({ page }) => {
    const loadBtn = page.locator('button', { hasText: 'Load' });
    await loadBtn.click();

    await expect(page.locator('text=Branch Point')).toBeVisible({ timeout: 10000 });

    const slider = page.locator('input[type="range"]');
    await expect(slider).toHaveAttribute('min', '1');

    await slider.fill('2');
    await expect(page.getByText('Turn 2 /')).toBeVisible();
  });

  test('clicking Branch Here replaces replay with branch sim in same iframe area', async ({ page }) => {
    const loadBtn = page.locator('button', { hasText: 'Load' });
    await loadBtn.click();

    await expect(page.locator('button', { hasText: 'Branch Here' })).toBeVisible({ timeout: 10000 });
    await page.locator('button', { hasText: 'Branch Here' }).click();

    // Should show branching header
    await expect(page.locator('text=Branching')).toBeVisible({ timeout: 15000 });

    // Should show "Back to Replay" instead of "Reset"
    await expect(page.locator('button', { hasText: 'Back to Replay' })).toBeVisible();

    // Branch sim iframe replaces the original — title changes
    const branchIframe = page.locator('iframe[title="Branch Simulation"]');
    await expect(branchIframe).toBeVisible({ timeout: 10000 });

    // Still only one iframe total
    const iframes = page.locator('iframe');
    await expect(iframes).toHaveCount(1);
  });

  test('branching shows P1 and P2 move controls below iframe', async ({ page }) => {
    const loadBtn = page.locator('button', { hasText: 'Load' });
    await loadBtn.click();

    await expect(page.locator('button', { hasText: 'Branch Here' })).toBeVisible({ timeout: 10000 });
    await page.locator('button', { hasText: 'Branch Here' }).click();

    await expect(page.locator('text=Branching')).toBeVisible({ timeout: 15000 });

    await expect(page.getByText('P1', { exact: true })).toBeVisible();
    await expect(page.getByText('P2', { exact: true })).toBeVisible();

    const fightBtns = page.locator('button', { hasText: 'Fight' });
    await expect(fightBtns.first()).toBeVisible();
  });

  test('branch simulation shows move buttons with type info', async ({ page }) => {
    const loadBtn = page.locator('button', { hasText: 'Load' });
    await loadBtn.click();

    await expect(page.locator('button', { hasText: 'Branch Here' })).toBeVisible({ timeout: 10000 });
    await page.locator('button', { hasText: 'Branch Here' }).click();

    await expect(page.locator('text=Branching')).toBeVisible({ timeout: 15000 });

    const moveBtns = page.locator('.ps-movebtn');
    await expect(moveBtns.first()).toBeVisible({ timeout: 5000 });
  });

  test('can switch to Pokémon tab to see switch options', async ({ page }) => {
    const loadBtn = page.locator('button', { hasText: 'Load' });
    await loadBtn.click();

    await expect(page.locator('button', { hasText: 'Branch Here' })).toBeVisible({ timeout: 10000 });
    await page.locator('button', { hasText: 'Branch Here' }).click();

    await expect(page.locator('text=Branching')).toBeVisible({ timeout: 15000 });

    const pokemonTab = page.locator('button', { hasText: 'Pokémon' }).first();
    await pokemonTab.click();

    const switchBtns = page.locator('.ps-switchbtn');
    await expect(switchBtns.first()).toBeVisible({ timeout: 5000 });
  });

  test('selecting moves for both sides enables Execute Turn button', async ({ page }) => {
    const loadBtn = page.locator('button', { hasText: 'Load' });
    await loadBtn.click();

    await expect(page.locator('button', { hasText: 'Branch Here' })).toBeVisible({ timeout: 10000 });
    await page.locator('button', { hasText: 'Branch Here' }).click();

    await expect(page.locator('text=Branching')).toBeVisible({ timeout: 15000 });

    const moveBtns = page.locator('.ps-movebtn');
    await expect(moveBtns.first()).toBeVisible({ timeout: 5000 });

    const allMoveBtns = await moveBtns.all();
    if (allMoveBtns.length >= 2) {
      await allMoveBtns[0].click();

      const moveGrids = page.locator('.ps-movegrid');
      const p2Grid = moveGrids.nth(1);
      const p2Moves = p2Grid.locator('.ps-movebtn');
      await p2Moves.first().click();

      const execBtn = page.locator('button', { hasText: 'Execute Turn' });
      await expect(execBtn).toBeVisible({ timeout: 5000 });
      await expect(execBtn).toBeEnabled();
    }
  });

  test('Back to Replay button returns to original replay', async ({ page }) => {
    const loadBtn = page.locator('button', { hasText: 'Load' });
    await loadBtn.click();

    await expect(page.locator('button', { hasText: 'Branch Here' })).toBeVisible({ timeout: 10000 });
    await page.locator('button', { hasText: 'Branch Here' }).click();

    await expect(page.locator('text=Branching')).toBeVisible({ timeout: 15000 });

    await page.locator('button', { hasText: 'Back to Replay' }).click();

    // Should return to Branch Here state with the original replay
    await expect(page.locator('button', { hasText: 'Branch Here' })).toBeVisible({ timeout: 5000 });
    await expect(page.locator('iframe[title="PS Replay"]')).toBeVisible();
  });

  test('team paste section is available', async ({ page }) => {
    const details = page.locator('details');
    await expect(details).toBeVisible();

    await details.locator('summary').click();

    const textarea = page.locator('textarea');
    await expect(textarea).toBeVisible();
    await expect(page.locator('button', { hasText: 'Save Team' })).toBeVisible();
  });

  test('Edit Opponent button appears after loading replay', async ({ page }) => {
    const loadBtn = page.locator('button', { hasText: 'Load' });
    await loadBtn.click();

    await expect(page.locator('button', { hasText: 'Edit Opponent' })).toBeVisible({ timeout: 10000 });
  });

  test('Battle Statistics panel appears after loading replay', async ({ page }) => {
    const loadBtn = page.locator('button', { hasText: 'Load' });
    await loadBtn.click();

    await expect(page.locator('text=Battle Statistics')).toBeVisible({ timeout: 10000 });

    // Should show both player columns
    await expect(page.locator('.ps-stats-team')).toHaveCount(2);

    // Should show pokemon entries with species names
    const pokemonEntries = page.locator('.ps-stats-pokemon');
    await expect(pokemonEntries.first()).toBeVisible();
  });
});
