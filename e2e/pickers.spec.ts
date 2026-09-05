import { test, expect } from '@playwright/test';
import { installReplayEmbedCache, routeOfflineFixtures, startVariationAt, waitForExactPickers } from './helpers';

test.beforeAll(installReplayEmbedCache);

test.describe('PS Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await routeOfflineFixtures(page);
    await page.goto('/');
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
});
