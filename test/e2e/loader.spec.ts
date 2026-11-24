import { readFileSync } from 'fs';
import { test, expect, type Route } from '@playwright/test';
import { routeSmogon } from './smogon-routes';
import { fixturePath, fromSetup, installReplayEmbedCache, routeOfflineFixtures } from './helpers';

test.beforeAll(installReplayEmbedCache);

test.describe('PS Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await routeOfflineFixtures(page);
    await page.goto('/');
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
    await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
    await expect(page.getByText('TestPlayer1', { exact: true }).first()).toBeVisible({ timeout: 10000 });

    await fromSetup(page, 'Import/Export Sets');
    const dialog = page.getByRole('dialog', { name: 'Import / Export Sets' });
    // The panel opens after the spread solve and the editor's pools: under the full suite the
    // unbundled dev server needs more than the default five seconds for both.
    await expect(dialog).toBeVisible({ timeout: 30_000 });

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
    await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
    await fromSetup(page, 'Import/Export Sets');
    const dialog = page.getByRole('dialog', { name: 'Import / Export Sets' });
    await dialog.locator('textarea')
      .fill('=== p1 ===\n\nGarchomp @ Choice Band\n- Earthquake');
    await dialog.locator('button', { hasText: 'Import' }).click();
    await expect(page.locator('.ps-main-right')).toContainText('Choice Band');

    await page.reload();
    await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
    await expect(page.locator('.ps-main-right')).toContainText('Choice Band', { timeout: 10000 });
  });

  test('team editor offers legal dropdown pools first, takes other moves and abilities with a note, and rejects unknown moves', async ({ page }) => {
    await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
    await expect(page.getByText('TestPlayer1', { exact: true }).first()).toBeVisible({ timeout: 10000 });
    await fromSetup(page, 'Edit Player');
    const editor = page.getByRole('dialog', { name: 'Edit Player Team' });
    const garchompCard = editor.locator('.ps-panel').filter({ hasText: 'Garchomp' }).first();

    // Ability is a select: the species' real abilities first, then every other ability of the generation.
    const abilitySelect = garchompCard.getByLabel('Garchomp ability');
    await expect(abilitySelect.locator('option', { hasText: 'Rough Skin' })).toHaveCount(1, { timeout: 10000 });
    await expect(abilitySelect.locator('option', { hasText: 'Sand Veil' })).toHaveCount(1);
    await expect(abilitySelect.locator('optgroup[label="Other abilities"] option', { hasText: 'Intimidate' })).toHaveCount(1);
    await abilitySelect.selectOption('Intimidate');
    await expect(garchompCard.getByText('Intimidate is not an ability of Garchomp.')).toBeVisible();
    await abilitySelect.selectOption('Rough Skin');
    await expect(garchompCard.getByText(/is not an ability of Garchomp/)).toHaveCount(0);

    // Nature select carries the 25 natures.
    await garchompCard.getByLabel('Garchomp nature').selectOption('Adamant');

    // A name the Dex does not know is rejected; a move the species cannot learn joins with a note; a legal one is picked by
    // CLICKING the combobox option, no Enter required.
    const moveInput = garchompCard.getByPlaceholder('Add move...');
    await garchompCard.getByLabel(/Remove .* from Garchomp/).first().click();
    await moveInput.fill('Moon Landing');
    await expect(garchompCard.getByText('No matching option')).toBeVisible();
    await moveInput.press('Enter');
    await expect(garchompCard.getByRole('alert')).toContainText('"Moon Landing" is not a known move.');
    await moveInput.fill('Spore');
    await garchompCard.getByRole('option', { name: 'Spore not learnable', exact: true }).click();
    await expect(garchompCard.getByText('not learnable', { exact: true })).toHaveCount(1);
    await expect(garchompCard.getByRole('alert')).toHaveCount(0);
    await garchompCard.getByLabel('Remove Spore from Garchomp').click();
    await moveInput.fill('Flame');
    await garchompCard.getByRole('option', { name: 'Flamethrower' }).click();
    await expect(garchompCard).toContainText('Flamethrower');

    await editor.locator('button', { hasText: /^Save$/ }).click();
    await expect(page.locator('.ps-main-right')).toContainText('Flamethrower');
  });

  test('shows single replay iframe after loading', async ({ page }) => {
    await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
    const iframe = page.locator('iframe[title="PS Replay"]');
    await expect(iframe).toBeVisible({ timeout: 10000 });
    await expect(page.locator('iframe')).toHaveCount(1);
  });

  test('an exported replay dropped anywhere on the page loads while a replay is loaded', async ({ page }) => {
    await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
    await expect(page.getByText('TestPlayer1', { exact: true }).first()).toBeVisible({ timeout: 10000 });

    const html = readFileSync(fixturePath('exported-replay.html'), 'utf-8');
    await page.evaluate(content => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([content], 'exported-replay.html', { type: 'text/html' }));
      const target = document.querySelector('.ps-branch-bar') ?? document.body;
      target.dispatchEvent(new DragEvent('dragover', { dataTransfer: transfer, bubbles: true, cancelable: true }));
      target.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
    }, html);

    await expect(page.getByText('Alpha', { exact: true }).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Beta', { exact: true }).first()).toBeVisible();
    // The panel closed after the load.
    await expect(page.locator('.ps-loader-panel')).toHaveCount(0);
  });
});
