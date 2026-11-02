import { test, expect } from '@playwright/test';
import { dockChip, installReplayEmbedCache, openTray, routeOfflineFixtures, startVariationAt } from './helpers';

test.beforeAll(installReplayEmbedCache);

test.beforeEach(async ({ page }) => {
  await routeOfflineFixtures(page);
  await page.goto('/');
});

for (const width of [1000, 390]) {
  test(`a narrow window (${width} px): the dock stands fixed at the lower edge, the page pads by its height, the tray is a sheet above it`, async ({ page }) => {
    // Round 84 (turn dock, A6b): at 1050 px and below the layout stacks and the dock leaves the column's flow.
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 800 });
    await page.reload();
    await page.locator('input[type="text"]').fill('gen9doubles-test');
    await page.locator('button', { hasText: 'Load' }).click();
    await startVariationAt(page, 1);

    const dock = page.locator('.ps-dock');
    await expect(dock).toBeVisible();
    expect(await dock.evaluate(element => getComputedStyle(element).position)).toBe('fixed');
    const box = (await dock.boundingBox())!;
    expect(box.x).toBe(0);
    expect(Math.abs(box.width - width)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y + box.height - 800)).toBeLessThanOrEqual(1);

    // --ps-dock-h follows the dock's box, and the page pads by it.
    const written = await page.evaluate(() => parseFloat(document.documentElement.style.getPropertyValue('--ps-dock-h')));
    expect(Math.abs(written - box.height)).toBeLessThanOrEqual(1);
    const padding = await page.locator('.ps-app-root').evaluate(element => parseFloat(getComputedStyle(element).paddingBottom));
    expect(padding).toBeGreaterThanOrEqual(box.height);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const rightBox = (await page.locator('.ps-main-right').boundingBox())!;
    expect(rightBox.y + rightBox.height).toBeLessThanOrEqual(box.y + 1);

    // Two chips per row, Execute on its own row under them, the app's 40 px minimum at 640 px.
    const first = (await dockChip(page, 'p1a').boundingBox())!;
    const partner = (await dockChip(page, 'p1b').boundingBox())!;
    const execute = (await page.locator('.ps-execute-btn').boundingBox())!;
    expect(partner.y).toBe(first.y);
    expect(partner.x).toBeGreaterThan(first.x);
    expect(execute.y).toBeGreaterThanOrEqual((await dockChip(page, 'p2a').boundingBox())!.y + first.height);
    if (width <= 640) {
      expect(first.height).toBeGreaterThanOrEqual(40);
      expect(execute.height).toBeGreaterThanOrEqual(40);
    }

    // The tray opens above the dock, across the width, up to 70 % of the viewport.
    const tray = await openTray(page, 'p1a');
    const trayBox = (await tray.boundingBox())!;
    expect(trayBox.y + trayBox.height).toBeLessThanOrEqual(box.y + 1);
    expect(Math.abs(trayBox.width - width)).toBeLessThanOrEqual(1);
    expect(trayBox.height).toBeLessThanOrEqual(0.7 * 800 + 1);
    expect(trayBox.y).toBeGreaterThanOrEqual(0);
  });
}
