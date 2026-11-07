import { test, expect, type Page } from '@playwright/test';
import { dockChip, dockTray, installReplayEmbedCache, routeOfflineFixtures } from './helpers';
import { Clicks, DOUBLES_SLOTS, failOnResizeLoops, lightEngine, loadDockReplay, variationPanel } from './dock-helpers';

/**
 * Round 84 (turn dock), step A7c, rulings 10a and 11a: the app on a phone (390 x 844, touch). The replay's battle scene shrinks to
 * the frame's width with the log under it, the page never scrolls sideways, the dock shows one chip a row (doubles: four rows at the
 * dock's 46 px) with the whole choice, the top bar takes two lines, and the task of criterion 1 (a move instead of the played one)
 * takes the same three clicks as at 1366 x 768.
 */
const DOUBLES = 'gen9doublesou-2693620934';
const TURN = 5;

test.beforeAll(installReplayEmbedCache);
failOnResizeLoops(test);
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test.beforeEach(async ({ page }) => {
  await lightEngine(page);
  await routeOfflineFixtures(page);
  await page.goto('/');
  await loadDockReplay(page, DOUBLES, TURN);
});

const frameOf = (page: Page) => page.frameLocator('.ps-iframe-wrap iframe').first();

test('the battle scene stands inside the frame with the log under it, and the page does not scroll sideways', async ({ page }) => {
  test.setTimeout(120_000);
  const iframe = page.locator('.ps-iframe-wrap iframe').first();
  const frameBox = (await iframe.boundingBox())!;
  expect(frameBox.width).toBeLessThanOrEqual(390);
  const battle = frameOf(page).locator('.battle');
  await expect(battle).toBeVisible({ timeout: 60_000 });
  await expect(frameOf(page).locator('html')).toHaveClass(/ps-phone/);
  const battleBox = (await battle.boundingBox())!;
  const logBox = (await frameOf(page).locator('.battle-log').boundingBox())!;
  // Round 84 (A7e): the scale is the frame's width over the battle's border box (642), so the scene's right edge is the frame's width
  // (Showdown's inline scale(width / 640) overshot by 1.1 px until the document's rule took !important). The numbers sit in the message.
  const inside = await frameOf(page).locator('html').evaluate(root => ({
    width: root.clientWidth,
    battleRight: root.querySelector('.battle')!.getBoundingClientRect().right,
    scale: root.style.getPropertyValue('--ps-k'),
  }));
  const numbers = JSON.stringify({ frameBox, battleBox, inside });
  expect(inside.battleRight, `the scene's right edge inside the document ${numbers}`).toBeLessThanOrEqual(inside.width + 0.05);
  expect(battleBox.x + battleBox.width, `the scene's right edge ${numbers}`).toBeLessThanOrEqual(frameBox.x + frameBox.width + 1);
  expect(battleBox.x).toBeGreaterThanOrEqual(frameBox.x - 1);
  expect(logBox.y, 'the log stands under the scene').toBeGreaterThanOrEqual(battleBox.y + battleBox.height - 1);
  expect(logBox.x + logBox.width).toBeLessThanOrEqual(frameBox.x + frameBox.width + 1);
  await expect(frameOf(page).locator('.battle-log')).toBeVisible();
  // The frame is as tall as its content: its height is above the desktop's 456 px, and the frame has no scroll of its own.
  expect(frameBox.height).toBeGreaterThan(456);
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(sideways, 'horizontal scroll of the page').toBeLessThanOrEqual(0);
});

// Round 88 (T316, #56): the frame keeps Play, Reset, Switch sides and Speed. On the 362 px frame row 1 stays on one line, the speed
// chooser fits its row, and nothing of either row reaches past the document's edge (before: Last turn, Next turn and Go to turn...
// broke row 1 into two lines and Music was cut). The widths go to the test's annotations for the ledger.
test('the frame\'s remaining controls fit the phone frame: row 1 on one line, the speed chooser whole, nothing past the edge', async ({ page }) => {
  test.setTimeout(120_000);
  const frame = frameOf(page);
  await expect(frame.locator('.replay-controls button[data-action="play"]')).toBeVisible({ timeout: 60_000 });
  await expect(frame.locator('html')).toHaveClass(/ps-phone/);
  const measured = await frame.locator('html').evaluate(root => {
    const visible = (selector: string) => [...root.querySelectorAll<HTMLElement>(selector)]
      .filter(element => getComputedStyle(element).display !== 'none' && element.getBoundingClientRect().width > 0);
    const spread = (elements: HTMLElement[]) => {
      const tops = elements.map(element => element.getBoundingClientRect().top);
      return tops.length ? Math.max(...tops) - Math.min(...tops) : 0;
    };
    const speed = root.querySelector<HTMLElement>('.speedchooser')!;
    const row1 = visible('.replay-controls button');
    const row2 = visible('.replay-controls-2 button');
    return {
      documentWidth: root.clientWidth,
      row1: row1.map(button => button.getAttribute('data-action')),
      row1Right: Math.max(...row1.map(button => button.getBoundingClientRect().right)),
      row1TopSpread: spread(row1),
      row2Right: Math.max(...row2.map(button => button.getBoundingClientRect().right)),
      speedButtons: row2.length,
      speedTopSpread: spread(visible('.speedchooser button')),
      speedClientWidth: speed.clientWidth,
      speedScrollWidth: speed.scrollWidth,
    };
  });
  test.info().annotations.push({ type: 'phone-controls', description: JSON.stringify(measured) });
  const numbers = JSON.stringify(measured);
  expect(measured.row1, `visible buttons of row 1 ${numbers}`).toEqual(['play', 'reset', 'switchViewpoint']);
  expect(measured.row1TopSpread, `row 1 shares one top ${numbers}`).toBeLessThanOrEqual(2);
  expect(measured.row1Right, `row 1 ends inside the document ${numbers}`).toBeLessThanOrEqual(measured.documentWidth + 0.5);
  expect(measured.speedButtons, `row 2 holds the five speed buttons ${numbers}`).toBe(5);
  expect(measured.speedTopSpread, `the five speed buttons share one top ${numbers}`).toBeLessThanOrEqual(2);
  expect(measured.speedScrollWidth, `the speed chooser is not cut ${numbers}`).toBeLessThanOrEqual(measured.speedClientWidth);
  expect(measured.row2Right, `row 2 ends inside the document ${numbers}`).toBeLessThanOrEqual(measured.documentWidth + 0.5);
});

test('the dock: four chip rows of 46 px with the whole choice, Execute under them, the top bar on two lines', async ({ page }) => {
  test.setTimeout(120_000);
  const boxes = [];
  for (const slot of DOUBLES_SLOTS) boxes.push((await dockChip(page, slot).boundingBox())!);
  for (let i = 1; i < boxes.length; i++) {
    expect(boxes[i].x, `chip ${i} stands under chip ${i - 1}`).toBe(boxes[0].x);
    expect(boxes[i].y).toBeGreaterThanOrEqual(boxes[i - 1].y + boxes[i - 1].height);
  }
  for (const box of boxes) expect(Math.round(box.height)).toBe(46);
  // The whole choice: no pick line is cut by its box.
  for (const slot of DOUBLES_SLOTS) {
    const cut = await dockChip(page, slot).locator('.ps-dock-pick').evaluate(element => element.scrollWidth - element.clientWidth);
    expect(cut, `the pick line of ${slot}`).toBeLessThanOrEqual(1);
  }
  const execute = (await page.locator('.ps-execute-btn').boundingBox())!;
  expect(execute.y).toBeGreaterThanOrEqual(boxes[3].y + boxes[3].height);
  // The top bar: two lines at most. Its height is below three lines' (74 px before).
  const bar = (await page.locator('.ps-topbar').boundingBox())!;
  expect(bar.height, 'height of the top bar').toBeLessThan(64);
  // A row is a run of children whose boxes overlap in height: the children of one row differ in height and sit centred, so their
  // tops differ by several px (the A7c run bucketed the tops by tens and counted one row twice).
  const rows = await page.locator('.ps-topbar > *').evaluateAll(elements => {
    const boxes = elements.map(element => element.getBoundingClientRect()).sort((a, b) => a.top - b.top);
    const found: { top: number; bottom: number }[] = [];
    for (const box of boxes) {
      const row = found[found.length - 1];
      if (row && box.top < row.bottom - 1) row.bottom = Math.max(row.bottom, box.bottom);
      else found.push({ top: box.top, bottom: box.bottom });
    }
    return found;
  });
  expect(rows.length, `rows of the top bar's children ${JSON.stringify(rows)}`).toBeLessThanOrEqual(2);
});

test('task 1 on a phone, a move instead of the played one: the same 3 clicks (chip, tile, Execute)', async ({ page }) => {
  test.setTimeout(180_000);
  const clicks = new Clicks();
  await clicks.click(dockChip(page, 'p1a'));
  const other = dockTray(page).locator('.ps-movebtn:enabled', { hasNotText: 'Knock Off' }).first();
  const name = ((await other.locator('.ps-movebtn-name').first().textContent()) ?? '').trim();
  expect(name).not.toBe('');
  await clicks.click(other);
  await expect(dockChip(page, 'p1a')).toContainText(name);
  await clicks.click(page.locator('.ps-execute-btn'));
  expect(clicks.count).toBe(3);
  await expect(variationPanel(page)).toContainText(`Turn ${TURN}`, { timeout: 90_000 });
  await expect(variationPanel(page)).toContainText(name);
});
