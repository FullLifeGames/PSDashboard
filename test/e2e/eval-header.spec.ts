import { test, expect, type Page } from '@playwright/test';
import { installReplayEmbedCache, routeOfflineFixtures } from './helpers';
import { lightEngine, loadDockReplay } from './dock-helpers';

/**
 * Round 89 (ruling 49): the Evaluation panel's header is one row at the desktop width of the right column (1280 px and wider):
 * "Evaluation", the engine controls, "Depth", "Tera" and the checkbox "Always on" share one line, and the row "Game graph" with
 * "Analyze game" stays its own row below. At 390 px the header may wrap. The spec reads the boxes of the header's children; the
 * screenshots at 1280 and 390 px go to SHOTS_DIR when it is set (the gate's folder of the round).
 */
test.beforeAll(installReplayEmbedCache);

test.beforeEach(async ({ page }) => {
  await lightEngine(page);
  // Depth Auto, as the user's header reads (lightEngine stores the matrix mode, which adds a Samples select).
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
    // one line: every child's vertical span holds the middle of the first child ("Evaluation")
    const middle = (boxes[0].top + boxes[0].bottom) / 2;
    for (const box of boxes) {
      expect(box.top, `${box.text} top against the line`).toBeLessThanOrEqual(middle);
      expect(box.bottom, `${box.text} bottom against the line`).toBeGreaterThanOrEqual(middle);
      expect(box.right, `${box.text} stays in the panel`).toBeLessThanOrEqual(panel.right + 0.5);
    }
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
