import { test, expect, type Page } from '@playwright/test';
import { installReplayEmbedCache, routeOfflineFixtures } from './helpers';
import { dockChip, dockTray } from './helpers';
import { lightEngine, loadDockReplay } from './dock-helpers';

/**
 * Round 89 (ruling 49): the Evaluation panel's header is one row at the desktop width of the right column (1280 px and wider):
 * "Evaluation", the engine controls, "Tera" and the checkbox "Always on" share one line, and the row "Game graph" with
 * "Analyze game" stays its own row below. Depth and Samples are rows of the Setup menu now (ruling 49), so a stored matrix depth adds nothing
 * to the header. At 390 px the header may wrap. The spec reads the boxes of the header's children; the
 * screenshots at 1280 and 390 px go to SHOTS_DIR when it is set (the gate's folder of the round).
 */
test.beforeAll(installReplayEmbedCache);

test.beforeEach(async ({ page }) => {
  await lightEngine(page);
  // Depth Auto, as the user's setup reads (lightEngine stores the matrix mode); the stored-depth rows override it.
  await page.addInitScript(() => {
    localStorage.setItem('ps-replay-interceptor:eval-prefs', JSON.stringify({ depth: 1, samples: 1, mode: 'auto', auto: false, tera: 'auto' }));
  });
  await routeOfflineFixtures(page);
});

interface Box { text: string; top: number; bottom: number; left: number; right: number }

async function headerBoxes(page: Page): Promise<{ boxes: Box[]; panel: { left: number; right: number }; graphTop: number }> {
  await page.locator('.ps-eval-panel .ps-eval-controls').waitFor({ timeout: 30_000 });
  await page.getByRole('checkbox', { name: 'Always on' }).waitFor({ timeout: 30_000 });
  return page.evaluate(() => {
    const head = document.querySelector('.ps-eval-panel .ps-eval-controls') as HTMLElement;
    const panel = (document.querySelector('.ps-eval-panel') as HTMLElement).getBoundingClientRect();
    const boxes = [...head.children].map(child => {
      const rect = child.getBoundingClientRect();
      return { text: (child.textContent ?? '').trim().slice(0, 30), top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
    }).filter(box => box.right > box.left);
    const graph = [...document.querySelectorAll('.ps-eval-panel button')].find(button => /Analyze game|Re-analyze/.test(button.textContent ?? ''));
    return { boxes, panel: { left: panel.left, right: panel.right }, graphTop: graph ? graph.getBoundingClientRect().top : Infinity };
  });
}

/** One line: every child's vertical span holds the middle of the first child ("Evaluation"), and none leaves the panel. */
function expectOneLine(boxes: Box[], panel: { right: number }): void {
  const middle = (boxes[0].top + boxes[0].bottom) / 2;
  for (const box of boxes) {
    expect(box.top, `${box.text} top against the line`).toBeLessThanOrEqual(middle);
    expect(box.bottom, `${box.text} bottom against the line`).toBeGreaterThanOrEqual(middle);
    expect(box.right, `${box.text} stays in the panel`).toBeLessThanOrEqual(panel.right + 0.5);
  }
}

const SHOTS = process.env.SHOTS_DIR;

for (const viewport of [{ width: 1280, height: 800 }, { width: 1707, height: 900 }]) {
  test(`the header of the Evaluation panel is one row at ${viewport.width} px`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(viewport);
    await page.goto('/');
    await loadDockReplay(page, 'gen9doublesou-2693620934', 5);
    const { boxes, panel, graphTop } = await headerBoxes(page);
    const names = boxes.map(box => box.text);
    expect(names.some(text => text.startsWith('Evaluation')), `header children ${names.join(' | ')}`).toBe(true);
    expect(names.some(text => text.startsWith('Always on')), `header children ${names.join(' | ')}`).toBe(true);
    expectOneLine(boxes, panel);
    expect(names.some(text => text.startsWith('Depth') || text.startsWith('Samples')), `no Depth or Samples in the header: ${names.join(' | ')}`).toBe(false);
    // the Analyze game row stays below the header
    expect(graphTop).toBeGreaterThan(Math.max(...boxes.map(box => box.bottom)));
    if (SHOTS) await page.locator('.ps-eval-panel').screenshot({ path: `${SHOTS}/eval-header-${viewport.width}-panel.png` });
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/eval-header-${viewport.width}.png` });
  });
}

/**
 * The test machine has no Verdana and falls back to a narrower face (Liberation Sans); Verdana runs about 12 % wider. The header must hold
 * its one row with the header's type enlarged by that much, or it wraps again on the machines that have Verdana.
 */
test('the header is still one row at 1280 px with Verdana-wide type (12 % larger)', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await loadDockReplay(page, 'gen9doublesou-2693620934', 5);
  await page.addStyleTag({ content: '.ps-eval-controls label, .ps-eval-controls button, .ps-eval-controls select { font-size: 11.2px !important } .ps-eval-controls-title { font-size: 14.6px !important }' });
  const { boxes, panel } = await headerBoxes(page);
  console.log(`WIDE ${JSON.stringify(boxes.map(box => [box.text, Math.round(box.left), Math.round(box.right), Math.round(box.top)]))} panel right ${panel.right}`);
  const middle = (boxes[0].top + boxes[0].bottom) / 2;
  for (const box of boxes) {
    expect(box.top, `${box.text} top against the line`).toBeLessThanOrEqual(middle);
    expect(box.bottom, `${box.text} bottom against the line`).toBeGreaterThanOrEqual(middle);
  }
  if (SHOTS) await page.locator('.ps-eval-panel').screenshot({ path: `${SHOTS}/eval-header-1280-wide-type-panel.png` });
});

test('at 390 px the header may wrap, and every control stays inside the panel', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await loadDockReplay(page, 'gen9doublesou-2693620934', 5);
  const { boxes, panel } = await headerBoxes(page);
  for (const box of boxes) expect(box.right, `${box.text} stays in the panel`).toBeLessThanOrEqual(panel.right + 0.5);
  if (SHOTS) {
    await page.locator('.ps-eval-panel').screenshot({ path: `${SHOTS}/eval-header-390-panel.png` });
    await page.screenshot({ path: `${SHOTS}/eval-header-390.png` });
  }
});

test.describe('with a stored matrix depth', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('ps-replay-interceptor:eval-prefs', JSON.stringify({ depth: 2, samples: 3, mode: 'matrix', auto: false, tera: 'auto' }));
    });
  });

  test('the header stays one row at 1280 px, and the Setup menu shows Depth 2 with Samples and takes the user back to Auto', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await loadDockReplay(page, 'gen9doublesou-2693620934', 5);
    const { boxes, panel } = await headerBoxes(page);
    expectOneLine(boxes, panel);
    expect(boxes.map(box => box.text).some(text => /^(Depth|Samples)/.test(text))).toBe(false);
    await page.getByRole('button', { name: 'Setup' }).click();
    const menu = page.locator('.ps-setup-panel');
    await expect(menu.locator('label', { hasText: 'Depth' }).locator('select')).toHaveValue('2');
    await expect(menu.locator('label', { hasText: 'Samples' }).locator('select')).toHaveValue('3');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/setup-1280-depth2.png` });
    await menu.locator('label', { hasText: 'Depth' }).locator('select').selectOption('auto');
    await expect(menu.locator('label', { hasText: 'Samples' })).toHaveCount(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ps-replay-interceptor:eval-prefs') ?? '{}').mode)).toBe('auto');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/setup-1280-auto.png` });
  });

  test('at 390 px the Setup menu stays inside the window with Depth and Samples', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await loadDockReplay(page, 'gen9doublesou-2693620934', 5);
    await page.getByRole('button', { name: 'Setup' }).click();
    const menu = page.locator('.ps-setup-panel');
    await expect(menu.locator('label', { hasText: 'Samples' })).toBeVisible();
    const box = (await menu.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390 + 0.5);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/setup-390-depth2.png` });
    await menu.locator('label', { hasText: 'Depth' }).locator('select').selectOption('auto');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/setup-390-auto.png` });
  });

  for (const width of [1280, 390]) {
    test(`inside a variation at ${width} px the header shows "Auto" and the button beside the rest${width === 1280 ? '; one row, or the wrap is measured' : ''}`, async ({ page }) => {
      test.setTimeout(180_000);
      await page.setViewportSize({ width, height: width === 1280 ? 800 : 844 });
      await page.goto('/');
      await loadDockReplay(page, 'gen9doublesou-2693620934', 5);
      await dockChip(page, 'p1a').click();
      await dockTray(page).locator('.ps-movebtn:enabled').first().click();
      await page.locator('.ps-execute-btn').click();
      await expect(page.locator('.ps-panel', { hasText: 'Variation moves' })).toContainText('Turn 5', { timeout: 90_000 });
      await page.getByRole('checkbox', { name: 'Auto', exact: true }).waitFor({ timeout: 30_000 });
      const { boxes, panel } = await headerBoxes(page);
      console.log(`VARIATION ${width} ${JSON.stringify(boxes.map(box => [box.text, Math.round(box.left), Math.round(box.right), Math.round(box.top)]))} panel right ${panel.right}`);
      if (SHOTS) await page.locator('.ps-eval-panel').screenshot({ path: `${SHOTS}/eval-header-${width}-variation-panel.png` });
      if (width === 1280) expectOneLine(boxes, panel);
      if (width === 1280) {
        // Measured, not pinned: with Verdana-wide type (12 % larger) the variation row has less slack than the main line's.
        await page.addStyleTag({ content: '.ps-eval-controls label, .ps-eval-controls button, .ps-eval-controls select { font-size: 11.2px !important } .ps-eval-controls-title { font-size: 14.6px !important }' });
        const wide = await headerBoxes(page);
        console.log(`VARIATION-WIDE ${JSON.stringify(wide.boxes.map(box => [box.text, Math.round(box.left), Math.round(box.right), Math.round(box.top)]))} panel right ${wide.panel.right}`);
      }
      else for (const box of boxes) expect(box.right, `${box.text} stays in the panel`).toBeLessThanOrEqual(panel.right + 0.5);
    });
  }
});
