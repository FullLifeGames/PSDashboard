import { test, expect } from '@playwright/test';
import {
  dockChip, dockTray, fromSetup, installReplayEmbedCache, openTray, openTrayMore, pickMove, routeOfflineFixtures, startVariationAt, waitForExactPickers,
} from './helpers';

test.beforeAll(installReplayEmbedCache);

// Round 84 (turn dock): the pickers are the dock's chips and trays. A chip opens its slot's tray (move tiles, the targets of the
// pending move, bench tiles); the dice, the What-if loader and all choices sit behind the tray's "Dice · What if".
test.describe('PS Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await routeOfflineFixtures(page);
    await page.goto('/');
  });

  test('the loaded replay shows P1 and P2 chips whose trays list moves and switches', async ({ page }) => {
    await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();

    // Round 80 (T297): the pickers themselves carry the load wait. The Battle Statistics panel shows its "P1" first, and
    // under the full suite the pickers came more than five seconds after it.
    const chips = page.locator('.ps-dock-chip');
    await expect(chips.first()).toBeVisible({ timeout: 15000 });
    await expect(chips.first()).toContainText('P1');
    await expect(chips.nth(1)).toContainText('P2');
    // One tray lists the slot's moves AND its switches, no tabs.
    const tray = await openTray(page, 'p1a');
    await expect(tray.locator('.ps-movebtn').first()).toBeVisible();
    await expect(tray.locator('.ps-switchbtn').first()).toBeVisible();
  });

  test('the move tiles show type and damage', async ({ page }) => {
    await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
    await expect(dockChip(page, 'p1a')).toBeVisible({ timeout: 15000 });
    const tray = await openTray(page, 'p1a');
    const earthquake = tray.locator('.ps-movebtn', { hasText: 'Earthquake' });
    await expect(earthquake.locator('.ps-type-tag')).toHaveText('Ground');
    // Range history: shifted when spread inference started overlaying
    // damage-consistent EVs (51–60.9%), then again when the goodness-of-fit
    // forfeit rejected this synthetic log's hand-authored damage numbers —
    // no legal spread fits them, so the degenerate solve (Bold 0-Atk
    // Garchomp) falls back to the species default and Earthquake hits real.
    // The snapshot picker feeds the same guessed sets (nature/EV spread)
    // into the same calc, so the pinned range carries over unchanged.
    // Round 84 (turn dock): the tile's bar shows the whole-percent range; the exact range sits in the tile's tooltip.
    await expect(earthquake).toHaveAttribute('title', /69\.8% - 82\.2%/, { timeout: 10000 });
  });

  test('the dock picks moves without Smogon stats', async ({ page }) => {
    await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
    await expect(dockChip(page, 'p1a')).toBeVisible({ timeout: 15000 });

    // The chip reads the pick as notation: the bare move name, no raw command (pickMove waits for the name on the chip).
    await pickMove(page, 'p1a');
    await expect(dockChip(page, 'p1a')).not.toHaveAttribute('data-empty', 'true');
  });

  test('the dock accepts custom move choices from the tray\'s choice picker', async ({ page }) => {
    await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
    await expect(dockChip(page, 'p1a')).toBeVisible({ timeout: 15000 });

    // The free-choice dropdown lives behind "Dice · What if".
    const tray = await openTrayMore(page, 'p1a');
    const picker = tray.locator('select[aria-label^="Choice picker"]');
    await expect(picker).toBeVisible({ timeout: 15000 });
    await picker.selectOption({ index: 1 });

    // The chip shows the pick as the user's own (no "played" mark) in notation (B1).
    await expect(dockChip(page, 'p1a')).not.toHaveAttribute('data-empty', 'true');
    await expect(dockChip(page, 'p1a')).not.toHaveAttribute('data-origin', 'played');
  });

  test('saving player edits refreshes the pickers and exposes EV controls', async ({ page }) => {
    await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
    await expect(dockChip(page, 'p1a')).toBeVisible({ timeout: 15000 });

    await fromSetup(page, 'Edit Player');
    const editor = page.getByRole('dialog', { name: 'Edit Player Team' });
    // The editor opens after the spread solve (T234), more than five seconds under the full suite (round 77).
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await expect(editor.getByLabel('Garchomp HP EVs')).toBeVisible();
    // Round 76 (T234): the editor opens on the solved spread (the fixture's Garchomp: 252 Atk / 252 Spe / 4 SpD, 508 of the 510 EVs),
    // and a typed value is cut to what the total leaves. The spread is therefore edited from the bottom: free the points, then spend them.
    await editor.getByLabel('Garchomp Spe EVs').fill('4');
    await editor.getByLabel('Garchomp SpD EVs').fill('0');
    await editor.getByLabel('Garchomp Atk EVs').fill('252');
    await editor.getByLabel('Garchomp HP EVs').fill('252');
    const garchompCard = editor.locator('.ps-panel').filter({ hasText: 'Garchomp' }).first();
    await garchompCard.getByLabel(/Remove .* from Garchomp/).first().click();
    await garchompCard.getByPlaceholder('Add move...').fill('Dragon Claw');
    await garchompCard.getByPlaceholder('Add move...').press('Enter');
    await editor.locator('button', { hasText: /^Save$/ }).click();

    // The rebuilt picker may close an open tray: open it again until it lists the new move.
    await expect(async () => {
      const tray = await openTray(page, 'p1a', { timeout: 3000 });
      await expect(tray).toContainText('Dragon Claw', { timeout: 3000 });
    }).toPass({ timeout: 15000 });
    await expect(page.locator('.ps-main-right')).toContainText('252 HP / 252 Atk / 4 Spe EVs');

    await fromSetup(page, 'Edit Player');
    const reopenedEditor = page.getByRole('dialog', { name: 'Edit Player Team' });
    await expect(reopenedEditor.getByLabel('Garchomp HP EVs')).toHaveValue('252');
  });

  test('saving player edits mid-branch preserves branch progress and pending choices', async ({ page }) => {
    await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
    await startVariationAt(page, 1, { p1Move: 'Swords Dance' });
    await expect(page.getByText(/Branching · Turn 2/)).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.ps-panel', { hasText: 'Variation moves' })).toContainText('Turn 1');

    // The chip shows the pending pick (pickMove waits for the name on the chip).
    const p2Move = await pickMove(page, 'p2a');
    await expect(dockChip(page, 'p2a')).not.toHaveAttribute('data-empty', 'true');

    await fromSetup(page, 'Edit Player');
    const editor = page.getByRole('dialog', { name: 'Edit Player Team' });
    const garchompCard = editor.locator('.ps-panel').filter({ hasText: 'Garchomp' }).first();
    await garchompCard.getByLabel('Remove Earthquake from Garchomp').click();
    await garchompCard.getByPlaceholder('Add move...').fill('Stone Edge');
    await garchompCard.getByPlaceholder('Add move...').press('Enter');
    await editor.locator('button', { hasText: /^Save$/ }).click();

    await expect(page.getByText(/Branching.*Turn 2/)).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.ps-panel', { hasText: 'Variation moves' })).toContainText('Turn 1');
    await expect(async () => {
      const tray = await openTray(page, 'p1a', { timeout: 3000 });
      await expect(tray).toContainText('Stone Edge', { timeout: 3000 });
      await expect(tray).not.toContainText('Earthquake', { timeout: 3000 });
    }).toPass({ timeout: 15000 });
    await expect(dockChip(page, 'p2a')).toContainText(p2Move);

    // While the rebuilt position lands the pickers stand in for it and take no input (round 77): click until the pick holds.
    await expect(async () => {
      const tray = await openTray(page, 'p1a', { timeout: 3000 });
      await tray.locator('.ps-movebtn', { hasText: 'Stone Edge' }).click({ timeout: 3000 });
      await expect(page.locator('button', { hasText: 'Execute Turn' })).toBeEnabled({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
  });

  test('snapshot pickers upgrade to the exact position on dwell — no button', async ({ page }) => {
    await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
    // The approximation renders first (PP unknown = dash) …
    await expect(page.getByText(/Choices approximated/)).toBeVisible({ timeout: 15000 });
    await expect(page.locator('button', { hasText: 'Rebuild exact position' })).toHaveCount(0);
    // … and after settling, the background reconstruction upgrades it in
    // place: real PP appears and the source line says so.
    await waitForExactPickers(page);
    const tray = await openTray(page, 'p1a');
    await expect(tray.locator('.ps-movebtn-pp').first()).toHaveText(/\d+\/\d+/);
  });

  test('selecting moves for both sides enables Execute Turn', async ({ page }) => {
    await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
    await expect(dockChip(page, 'p1a')).toBeVisible({ timeout: 15000 });

    await pickMove(page, 'p1a');
    await pickMove(page, 'p2a');

    const execBtn = page.locator('button', { hasText: 'Execute Turn' });
    await expect(execBtn).toBeVisible({ timeout: 5000 });
    await expect(execBtn).toBeEnabled();
  });

  test('branching can load a hypothetical move from the legal pool', async ({ page }) => {
    await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
    // The what-if controls live behind "Dice · What if" — open it,
    // then loading the move rebuilds the sim with the choice pre-seeded.
    const tray = await openTrayMore(page, 'p1a');
    const whatIf = tray.getByLabel('Hypothetical move for P1');

    // Garchomp knows 3 moves — the hypothetical simply becomes the 4th.
    // Picking from the combobox popup fills the field without pressing Enter.
    await expect(whatIf).toBeVisible({ timeout: 15000 });
    await expect(tray.getByLabel('Replaced move for P1')).toHaveCount(0);
    await whatIf.fill('Flamethr');
    await tray.getByRole('option', { name: 'Flamethrower' }).click();
    await expect(whatIf).toHaveValue('Flamethrower');
    await tray.locator('button', { hasText: 'Load move' }).click();

    // The branch rebuilds with the move in the set and pre-selected as pending: the chip names it, the tray lists it.
    await expect(page.getByText(/Branching.*Turn/)).toBeVisible({ timeout: 15000 });
    await expect(dockChip(page, 'p1a')).toContainText('Flamethrower', { timeout: 15000 });
    // The rebuild closes the tray the loader belonged to: open it again until it stands with the new tile.
    await expect(async () => {
      const reopened = await openTrayMore(page, 'p1a', { timeout: 3000 });
      await expect(reopened.locator('.ps-movebtn', { hasText: 'Flamethrower' })).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 15000 });
    const trayAgain = dockTray(page);

    // Now the set is full — a second hypothetical must replace a chosen move.
    const whatIfAgain = trayAgain.getByLabel('Hypothetical move for P1');
    await whatIfAgain.fill('Fire Blast');
    await trayAgain.getByLabel('Replaced move for P1').selectOption({ label: 'Earthquake' });
    await trayAgain.locator('button', { hasText: 'Load move' }).click();

    await expect(dockChip(page, 'p1a')).toContainText('Fire Blast', { timeout: 15000 });
    await expect(async () => {
      const trayLast = await openTray(page, 'p1a', { timeout: 3000 });
      await expect(trayLast.locator('.ps-movebtn', { hasText: 'Fire Blast' })).toBeVisible({ timeout: 3000 });
      await expect(trayLast.locator('.ps-movebtn', { hasText: 'Earthquake' })).toHaveCount(0, { timeout: 3000 });
    }).toPass({ timeout: 15000 });
  });

  test('doubles branch shows slot chips and blocks duplicate simultaneous switches', async ({ page }) => {
    await page.locator('input[type="text"]').fill('gen9doubles-test');
    await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
    await expect(page.getByText('Alice', { exact: true }).first()).toBeVisible({ timeout: 10000 });
    // Doubles targeting needs the real request — the dwell upgrade delivers it.
    await waitForExactPickers(page);

    const chips = page.locator('.ps-dock-chip');
    await expect(chips).toHaveCount(4);
    await expect(chips.nth(0)).toContainText('P1A');
    await expect(chips.nth(1)).toContainText('P1B');
    await expect(chips.nth(2)).toContainText('P2A');
    await expect(chips.nth(3)).toContainText('P2B');

    // Each slot's tray lists its switch tiles without a tab switch.
    const trayA = await openTray(page, 'p1a');
    await expect(trayA.locator('.ps-switchbtn').first()).toBeVisible({ timeout: 5000 });
    await trayA.locator('.ps-switchbtn').first().click();
    const trayB = await openTray(page, 'p1b');
    await expect(trayB.locator('.ps-switchbtn').first()).toBeVisible();
    await expect(trayB.locator('.ps-switchbtn').first()).toBeDisabled();
  });

  test('doubles target buttons identify and highlight the selected target', async ({ page }) => {
    await page.locator('input[type="text"]').fill('gen9doubles-test');
    await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
    await expect(page.getByText('Alice', { exact: true }).first()).toBeVisible({ timeout: 10000 });
    // Doubles targeting needs the real request — the dwell upgrade delivers it.
    await waitForExactPickers(page);

    // Round 84 (turn dock): the target buttons of a move show once the move is the slot's pending pick.
    const pikachuTray = await openTray(page, 'p1a');
    await pikachuTray.locator('.ps-movebtn', { hasText: 'Thunderbolt' }).click();
    const bulbasaurTarget = pikachuTray.locator('.ps-target-btn[title^="Thunderbolt into Bulbasaur"]');
    const charmanderTarget = pikachuTray.locator('.ps-target-btn[title^="Thunderbolt into Charmander"]');
    await expect(bulbasaurTarget).toBeVisible();
    await expect(charmanderTarget).toBeVisible();
    await expect(bulbasaurTarget).toContainText('P2A Bulbasaur');
    await expect(charmanderTarget).toContainText('P2B Charmander');

    await charmanderTarget.click();
    await expect(charmanderTarget).toHaveClass(/ps-target-btn-selected/);
    await expect(bulbasaurTarget).not.toHaveClass(/ps-target-btn-selected/);
  });

  test('picking a doubles move or target leaves every move button in place', async ({ page }) => {
    await page.locator('input[type="text"]').fill('gen9doubles-test');
    await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
    await expect(page.getByText('Alice', { exact: true }).first()).toBeVisible({ timeout: 10000 });
    await waitForExactPickers(page);

    const tray = await openTray(page, 'p1a');
    const moves = tray.locator('.ps-movebtn');
    // Measured in the tray's own content box: the target row grows the tray upwards, and a click scrolls the page to its button.
    const boxes = () => tray.evaluate(box => {
      const origin = box.getBoundingClientRect();
      return [...box.querySelectorAll('.ps-movebtn')].map(button => {
        const { x, y, width, height } = button.getBoundingClientRect();
        return { name: button.querySelector('.ps-movebtn-name')?.textContent, x: x - origin.x, y: y - origin.y + box.scrollTop, width, height };
      });
    });
    // The hover lift moves a button by a pixel: measure with the mouse away.
    const settledBoxes = async () => {
      await page.mouse.move(0, 0);
      return boxes();
    };

    await expect(moves.first()).toBeVisible({ timeout: 5000 });
    // The damage bars land after the tiles: take the reading once two reads in a row agree.
    let before = await settledBoxes();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await page.waitForTimeout(250);
      const next = await settledBoxes();
      if (JSON.stringify(next) === JSON.stringify(before)) break;
      before = next;
    }
    expect(before.length, "Pikachu's moves").toBeGreaterThan(1);

    // The user's scene: a click on the move itself, then on a target tile.
    await moves.first().click();
    await expect(moves.first()).toHaveClass(/ps-movebtn-selected/);
    await expect(tray.locator('.ps-target-btn').first()).toBeVisible({ timeout: 5000 });
    await expect.poll(settledBoxes, { message: 'after the move click', timeout: 5000 }).toEqual(before);
    const lastTarget = tray.locator('.ps-target-btn').last();
    await lastTarget.click();
    await expect(lastTarget).toHaveClass(/ps-target-btn-selected/);
    await expect.poll(settledBoxes, { message: 'after the target click', timeout: 5000 }).toEqual(before);
    await expect(tray).not.toContainText('Targeting');
  });

  test('a spread move lists its partner, its dice name each target, and the tiles and chips line up (round 83)', async ({ page }) => {
    await page.locator('input[type="text"]').fill('gen9doubles-spread-test');
    await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
    await expect(page.getByText('Alice', { exact: true }).first()).toBeVisible({ timeout: 10000 });
    await waitForExactPickers(page);
    const tray = await openTray(page, 'p1a');
    // Discharge hits Bulbasaur, Charmander and Pikachu's partner Eevee: one bar row per body, which wrap onto more lines
    const discharge = tray.locator('.ps-movebtn', { hasText: 'Discharge' });
    await expect(discharge.locator('.ps-tile-bar-label')).toHaveText(['P2A', 'P2B', 'P1B'], { timeout: 10000 });
    // The hover lift moves a tile by a pixel: measure with the mouse away.
    await page.mouse.move(0, 0);
    const layout = await page.evaluate(() => {
      const box = (element: Element) => {
        const { top, bottom, left, right } = element.getBoundingClientRect();
        return { top: Math.round(top), bottom: Math.round(bottom), left: Math.round(left), right: Math.round(right) };
      };
      // Tiles that share a top edge: in the open tray's grid, one row of tiles.
      const byTop = new Map<number, { tile: string; bottom: number }[]>();
      for (const tile of document.querySelectorAll('.ps-tray .ps-movebtn')) {
        const { top, bottom } = box(tile);
        byTop.set(top, [...(byTop.get(top) ?? []), { tile: tile.querySelector('.ps-movebtn-name')?.textContent ?? '', bottom }]);
      }
      const rows = [...byTop.values()].filter(row => row.length > 1);
      // The chips: P1's row over P2's, so a slot keeps its column.
      const chips = ['p10', 'p11', 'p20', 'p21'].map(key => {
        const chip = document.querySelector(`.ps-dock-chip[data-chip="${key}"]`);
        return chip ? box(chip) : null;
      });
      return { chips, rows };
    });
    expect(layout.chips.every(Boolean)).toBe(true);
    const [p1a, p1b, p2a, p2b] = layout.chips as { left: number; right: number }[];
    expect([p2a.left, p2a.right], 'P2A stands in the column of P1A').toEqual([p1a.left, p1a.right]);
    expect([p2b.left, p2b.right], 'P2B stands in the column of P1B').toEqual([p1b.left, p1b.right]);
    expect(layout.rows.some(row => row.some(({ tile }) => tile === 'Discharge'))).toBe(true);
    for (const row of layout.rows) expect(new Set(row.map(({ bottom }) => bottom)).size, JSON.stringify(row)).toBe(1);

    await discharge.click();
    const moreTray = await openTrayMore(page, 'p1a');
    // Round 84 (A4): the dice are a table, one column per target; each head names its slot and body.
    const heads = moreTray.locator('.ps-dice-table .ps-dice-heading');
    for (const [index, target] of ['P2A Bulbasaur', 'P2B Charmander', 'P1B Eevee'].entries()) {
      await expect(heads.nth(index), target).toHaveText(target, { timeout: 15000 });
    }
  });
});
