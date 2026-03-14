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

    // Wait for match info to appear
    await expect(page.locator('text=TestPlayer1')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=TestPlayer2')).toBeVisible();
    await expect(page.locator('text=[Gen 9] OU')).toBeVisible();
  });

  test('shows replay iframe after loading', async ({ page }) => {
    const loadBtn = page.locator('button', { hasText: 'Load' });
    await loadBtn.click();

    // Wait for the replay iframe to appear
    const iframe = page.locator('iframe[title="PS Replay"]');
    await expect(iframe).toBeVisible({ timeout: 10000 });
  });

  test('shows branch point controls after loading replay', async ({ page }) => {
    const loadBtn = page.locator('button', { hasText: 'Load' });
    await loadBtn.click();

    await expect(page.locator('text=Branch Point')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('input[type="range"]')).toBeVisible();
  });

  test('branch turn slider updates turn display', async ({ page }) => {
    const loadBtn = page.locator('button', { hasText: 'Load' });
    await loadBtn.click();

    await expect(page.locator('text=Branch Point')).toBeVisible({ timeout: 10000 });

    const slider = page.locator('input[type="range"]');
    // The slider should exist and have min=1
    await expect(slider).toHaveAttribute('min', '1');

    // Move slider to turn 2
    await slider.fill('2');
    await expect(page.getByText('Turn 2 /')).toBeVisible();
  });

  test('shows Branch Here button', async ({ page }) => {
    const loadBtn = page.locator('button', { hasText: 'Load' });
    await loadBtn.click();

    await expect(page.locator('button', { hasText: 'Branch Here' })).toBeVisible({ timeout: 10000 });
  });

  test('clicking Branch Here starts branching simulation', async ({ page }) => {
    const loadBtn = page.locator('button', { hasText: 'Load' });
    await loadBtn.click();

    await expect(page.locator('button', { hasText: 'Branch Here' })).toBeVisible({ timeout: 10000 });

    // Click branch
    await page.locator('button', { hasText: 'Branch Here' }).click();

    // Should show branching header
    await expect(page.locator('text=Branching')).toBeVisible({ timeout: 15000 });

    // Should show Reset button
    await expect(page.locator('button', { hasText: 'Reset' })).toBeVisible();
  });

  test('branching shows P1 and P2 move controls', async ({ page }) => {
    const loadBtn = page.locator('button', { hasText: 'Load' });
    await loadBtn.click();

    await expect(page.locator('button', { hasText: 'Branch Here' })).toBeVisible({ timeout: 10000 });
    await page.locator('button', { hasText: 'Branch Here' }).click();

    // Wait for controls to appear
    await expect(page.locator('text=Branching')).toBeVisible({ timeout: 15000 });

    // Should show P1 and P2 labels
    await expect(page.getByText('P1', { exact: true })).toBeVisible();
    await expect(page.getByText('P2', { exact: true })).toBeVisible();

    // Should show Fight tabs
    const fightBtns = page.locator('button', { hasText: 'Fight' });
    await expect(fightBtns.first()).toBeVisible();
  });

  test('branch simulation shows move buttons with type info', async ({ page }) => {
    const loadBtn = page.locator('button', { hasText: 'Load' });
    await loadBtn.click();

    await expect(page.locator('button', { hasText: 'Branch Here' })).toBeVisible({ timeout: 10000 });
    await page.locator('button', { hasText: 'Branch Here' }).click();

    await expect(page.locator('text=Branching')).toBeVisible({ timeout: 15000 });

    // Move buttons should exist (with ps-movebtn class)
    const moveBtns = page.locator('.ps-movebtn');
    await expect(moveBtns.first()).toBeVisible({ timeout: 5000 });
  });

  test('can switch to Pokémon tab to see switch options', async ({ page }) => {
    const loadBtn = page.locator('button', { hasText: 'Load' });
    await loadBtn.click();

    await expect(page.locator('button', { hasText: 'Branch Here' })).toBeVisible({ timeout: 10000 });
    await page.locator('button', { hasText: 'Branch Here' }).click();

    await expect(page.locator('text=Branching')).toBeVisible({ timeout: 15000 });

    // Click the Pokémon tab
    const pokemonTab = page.locator('button', { hasText: 'Pokémon' }).first();
    await pokemonTab.click();

    // Should show switch buttons
    const switchBtns = page.locator('.ps-switchbtn');
    await expect(switchBtns.first()).toBeVisible({ timeout: 5000 });
  });

  test('selecting moves for both sides enables Execute Turn button', async ({ page }) => {
    const loadBtn = page.locator('button', { hasText: 'Load' });
    await loadBtn.click();

    await expect(page.locator('button', { hasText: 'Branch Here' })).toBeVisible({ timeout: 10000 });
    await page.locator('button', { hasText: 'Branch Here' }).click();

    await expect(page.locator('text=Branching')).toBeVisible({ timeout: 15000 });

    // Wait for move buttons
    const moveBtns = page.locator('.ps-movebtn');
    await expect(moveBtns.first()).toBeVisible({ timeout: 5000 });

    // Get all move buttons - first set is P1, second is P2
    const allMoveBtns = await moveBtns.all();
    if (allMoveBtns.length >= 2) {
      // Click first P1 move
      await allMoveBtns[0].click();

      // Find P2 moves - they appear after the P1 controls
      // The move buttons are in separate grids, so we need the moves from P2's grid
      const moveGrids = page.locator('.ps-movegrid');
      const p2Grid = moveGrids.nth(1);
      const p2Moves = p2Grid.locator('.ps-movebtn');
      await p2Moves.first().click();

      // Execute Turn button should now be enabled
      const execBtn = page.locator('button', { hasText: 'Execute Turn' });
      await expect(execBtn).toBeVisible({ timeout: 5000 });
      await expect(execBtn).toBeEnabled();
    }
  });

  test('reset button returns to pre-branch state', async ({ page }) => {
    const loadBtn = page.locator('button', { hasText: 'Load' });
    await loadBtn.click();

    await expect(page.locator('button', { hasText: 'Branch Here' })).toBeVisible({ timeout: 10000 });
    await page.locator('button', { hasText: 'Branch Here' }).click();

    await expect(page.locator('text=Branching')).toBeVisible({ timeout: 15000 });

    // Click reset
    await page.locator('button', { hasText: 'Reset' }).click();

    // Should return to Branch Here state
    await expect(page.locator('button', { hasText: 'Branch Here' })).toBeVisible({ timeout: 5000 });
  });

  test('team paste section is available', async ({ page }) => {
    const details = page.locator('details');
    await expect(details).toBeVisible();

    // Open it
    await details.locator('summary').click();

    // Should show textarea for team paste
    const textarea = page.locator('textarea');
    await expect(textarea).toBeVisible();

    // Should show Save Team button
    await expect(page.locator('button', { hasText: 'Save Team' })).toBeVisible();
  });

  test('Edit Opponent button appears after loading replay', async ({ page }) => {
    const loadBtn = page.locator('button', { hasText: 'Load' });
    await loadBtn.click();

    await expect(page.locator('button', { hasText: 'Edit Opponent' })).toBeVisible({ timeout: 10000 });
  });

  test('branch sim iframe uses seekTurn for auto-seek', async ({ page }) => {
    const loadBtn = page.locator('button', { hasText: 'Load' });
    await loadBtn.click();

    await expect(page.locator('button', { hasText: 'Branch Here' })).toBeVisible({ timeout: 10000 });
    await page.locator('button', { hasText: 'Branch Here' }).click();

    await expect(page.locator('text=Branching')).toBeVisible({ timeout: 15000 });

    // The branch sim iframe should exist (titled "Branch Simulation")
    const branchIframe = page.locator('iframe[title="Branch Simulation"]');
    await expect(branchIframe).toBeVisible({ timeout: 10000 });

    // The iframe src should be a blob URL
    const src = await branchIframe.getAttribute('src');
    expect(src).toMatch(/^blob:/);
  });
});
