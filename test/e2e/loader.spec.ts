import { test, expect, type Route } from '@playwright/test';
import { routeSmogon } from './smogon-routes';
import { fixturePath, fixtureReplay, installReplayEmbedCache, routeOfflineFixtures } from './helpers';

test.beforeAll(installReplayEmbedCache);

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
      .setInputFiles(fixturePath('exported-replay.html'));

    await expect(page.getByText('Alpha', { exact: true }).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Beta', { exact: true }).first()).toBeVisible();
    await expect(page.locator('text=[Gen 9] Draft')).toBeVisible();
    await expect(page.locator('iframe[title="PS Replay"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.ps-branch-bar input[type="range"]')).toBeVisible();
  });

  test('shows a notice when the Smogon sets fail to load', async ({ page }) => {
    // Both data hosts unreachable: the fallback runs dry and the top bar says so.
    await routeSmogon(page, route => route.abort());
    await page.locator('button', { hasText: 'Load' }).click();
    await expect(page.getByText('Smogon sets unavailable')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Smogon stats unavailable')).toBeVisible();
  });

  test('displayed set guesses pass the coherence vetoes (GPL Cobalion)', async ({ page }) => {
    // Deterministic usage payload: Body Press tops the marginals while the
    // replay reveals Swords Dance — the panel must show the vetoed assembly
    // the simulator builds, never a second raw-usage guess (the GPL split).
    const cobalionUsage = (route: Route) => {
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
    };
    await routeSmogon(page, cobalionUsage);
    await page.locator('input[aria-label="Load exported replay file"]')
      .setInputFiles(fixturePath('gpl-replay.html'));

    const cobalion = page.locator('.ps-stats-pokemon', { hasText: 'Cobalion' });
    await expect(cobalion.getByText('Swords Dance')).toBeVisible({ timeout: 15000 });
    await expect(cobalion.getByText('Close Combat')).toBeVisible();
    await expect(cobalion.getByText('Body Press')).toHaveCount(0);
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
