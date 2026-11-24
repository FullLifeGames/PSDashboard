import { test, expect, type Page } from '@playwright/test';
import { dockChip, dockTray, installReplayEmbedCache, routeOfflineFixtures, waitForExactPickers } from './helpers';
import { Clicks, failOnResizeLoops, lightEngine, loadDockReplay, variationPanel } from './dock-helpers';

const DOUBLES = 'gen9doublesou-2693620934';
const TURN = 5;
const BATTLE_WIDTH = 642;

test.beforeAll(installReplayEmbedCache);
failOnResizeLoops(test);
test.use({ viewport: { width: 2560, height: 1290 } });

test.beforeEach(async ({ page }) => {
  await lightEngine(page);
  await routeOfflineFixtures(page);
  await page.goto('/');
});

const rootScale = (page: Page) => page.evaluate(() => document.documentElement.style.getPropertyValue('--ps-scale'));
const frameOf = (page: Page) => page.frameLocator('.ps-iframe-wrap iframe').first();

// Chromium reads the rect inside in the frame's CSS px (641 of 976), WebKit in screen px (962 of 1,464):
// the share of the document times the frame's rect on the screen is the same in both.
async function battleOnScreen(page: Page) {
  return page.evaluate(() => {
    const frame = document.querySelector('.ps-iframe-wrap iframe') as HTMLIFrameElement;
    const inside = frame.contentDocument!.querySelector('.battle')!.getBoundingClientRect();
    const outside = frame.getBoundingClientRect();
    const documentWidth = frame.contentDocument!.documentElement.clientWidth;
    const k = outside.width / documentWidth;
    return {
      k, width: inside.width * k, left: outside.left + inside.left * k, right: outside.left + inside.right * k,
      frameLeft: outside.left, frameRight: outside.right, rectInside: { x: inside.x, w: inside.width }, documentWidth,
    };
  });
}

async function openSetup(page: Page) {
  await page.getByRole('button', { name: 'Setup', exact: true }).click();
  return page.getByRole('combobox', { name: 'Size' });
}

test('Auto at 2560 x 1290 takes 150 %: the app fills the window, the column does not scroll, the replay scales with it', async ({ page }) => {
  test.setTimeout(120_000);
  await loadDockReplay(page, DOUBLES, TURN);
  expect(await rootScale(page)).toBe('1.5');
  const facts = await page.evaluate(() => {
    const left = document.querySelector('.ps-main-left') as HTMLElement;
    const app = document.querySelector('.ps-app-root') as HTMLElement;
    const frame = document.querySelector('.ps-iframe-wrap iframe') as HTMLIFrameElement;
    return {
      zoom: getComputedStyle(document.documentElement).zoom,
      appHeight: app.getBoundingClientRect().height, innerHeight: window.innerHeight,
      pageOverflow: document.documentElement.scrollHeight - window.innerHeight,
      leftOverflow: left.scrollHeight - left.clientHeight, leftScrollTop: left.scrollTop,
      frameVisual: frame.getBoundingClientRect().width, frameCss: frame.offsetWidth,
    };
  });
  expect(Number(facts.zoom), 'the root\'s zoom').toBeCloseTo(1.5, 5);
  expect(Math.abs(facts.appHeight - facts.innerHeight), `height of the app ${JSON.stringify(facts)}`).toBeLessThanOrEqual(2);
  expect(facts.pageOverflow, 'the page does not scroll').toBeLessThanOrEqual(1);
  expect(facts.leftOverflow, 'the left column does not scroll').toBeLessThanOrEqual(1);
  expect(facts.leftScrollTop).toBe(0);
  expect(facts.frameVisual / facts.frameCss, 'the frame element\'s scale').toBeCloseTo(1.5, 1);
  // The 642 px battle stands about 963 px wide on the screen (1.5 x); a frame that kept its 100 % layout shows 642.
  await expect(frameOf(page).locator('.battle')).toBeVisible({ timeout: 60_000 });
  const shown = await battleOnScreen(page);
  const message = `the battle on the screen ${JSON.stringify(shown)}`;
  expect(shown.width, message).toBeGreaterThan(BATTLE_WIDTH * 1.5 - 6);
  expect(shown.width, message).toBeLessThan(BATTLE_WIDTH * 1.5 + 6);
  // The battle's box may start 1 CSS px left of the document (its border), which is 1.5 px on the screen.
  expect(shown.left, message).toBeGreaterThanOrEqual(shown.frameLeft - 1.5 - 0.5);
  expect(shown.right, message).toBeLessThanOrEqual(shown.frameRight + 1);
});

test('the timeline slider lands where the pointer shows at 150 %', async ({ page }) => {
  test.setTimeout(120_000);
  await loadDockReplay(page, DOUBLES, TURN);
  expect(await rootScale(page)).toBe('1.5');
  const slider = page.locator('.ps-branch-bar input[type="range"]');
  const range = await slider.evaluate(input => ({ min: Number((input as HTMLInputElement).min), max: Number((input as HTMLInputElement).max) }));
  const box = (await slider.boundingBox())!;
  // The box is in screen pixels (150 %): a click at its middle reads half the range if the pointer hits what is shown.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const value = Number(await slider.inputValue());
  const middle = (range.min + range.max) / 2;
  expect(Math.abs(value - middle), `slider ${JSON.stringify({ range, value, box })}`).toBeLessThanOrEqual(Math.max(1.5, (range.max - range.min) * 0.06));
});

test('task 1 at 150 %, a move instead of the played one: the same 3 clicks (chip, tile, Execute)', async ({ page }) => {
  test.setTimeout(180_000);
  await loadDockReplay(page, DOUBLES, TURN);
  expect(await rootScale(page)).toBe('1.5');
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

test('a doubles variation with its history at 150 %: the left column does not scroll while the panel is closed', async ({ page }) => {
  test.setTimeout(180_000);
  await loadDockReplay(page, DOUBLES, TURN);
  expect(await rootScale(page)).toBe('1.5');
  await dockChip(page, 'p1a').click();
  await dockTray(page).locator('.ps-movebtn:enabled', { hasNotText: 'Knock Off' }).first().click();
  await page.locator('.ps-execute-btn').click();
  await expect(variationPanel(page)).toContainText(`Turn ${TURN}`, { timeout: 90_000 });
  const toggle = variationPanel(page).getByRole('button', { name: /Variation moves/ });
  await expect(toggle).toHaveText(/^▸ Variation moves · 1 turn$/);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  const overflow = () => page.evaluate(() => {
    const left = document.querySelector('.ps-main-left') as HTMLElement;
    return { overflow: left.scrollHeight - left.clientHeight, scrollTop: left.scrollTop };
  });
  const closed = await overflow();
  expect(closed.overflow, `closed ${JSON.stringify(closed)}`).toBeLessThanOrEqual(1);
  expect(closed.scrollTop).toBe(0);
  await toggle.click();
  await expect(page.getByText('Variation result').first()).toBeVisible();
});

test('the Size setting overrides Auto, persists across a reload, and disables a step that leaves under 1050 px', async ({ page }) => {
  test.setTimeout(180_000);
  await loadDockReplay(page, DOUBLES, TURN);
  let size = await openSetup(page);
  await expect(size).toHaveValue('auto');
  await expect(size.locator('option').first()).toHaveText('Auto (150 %)');
  expect(await rootScale(page)).toBe('1.5');

  await size.selectOption({ value: '1' });
  expect(await rootScale(page)).toBe('');
  expect(Math.abs((await page.locator('.ps-app-root').boundingBox())!.height - 1290)).toBeLessThanOrEqual(2);
  await size.selectOption({ value: '2' });
  expect(await rootScale(page)).toBe('2');
  expect(Math.abs((await page.locator('.ps-app-root').boundingBox())!.height - 1290)).toBeLessThanOrEqual(2);

  await page.reload();
  expect(await rootScale(page)).toBe('2');
  await waitForExactPickers(page, TURN);
  await expect(page.locator('.ps-dock-chip').first()).toBeVisible({ timeout: 30_000 });
  size = await openSetup(page);
  await expect(size).toHaveValue('2');

  // 1600 / 1.75 = 914 px < 1050: those steps are disabled, the chosen 200 % is held back to 150 %.
  // Options are read through `disabled`: toBeDisabled() retargets an option to its label's control, the select.
  await page.setViewportSize({ width: 1600, height: 1000 });
  await expect(size.locator('option', { hasText: /^175 %/ })).toHaveJSProperty('disabled', true);
  await expect(size.locator('option', { hasText: /^200 %/ })).toHaveJSProperty('disabled', true);
  await expect(size.locator('option', { hasText: /^175 %/ })).toHaveText('175 % (needs a window at least 1838 px wide)');
  await expect(size.locator('option', { hasText: /^150 %/ })).toHaveJSProperty('disabled', false);
  await expect.poll(() => rootScale(page)).toBe('1.5');

  await size.selectOption({ value: 'auto' });
  expect(await rootScale(page)).toBe('');
  await expect(size.locator('option').first()).toHaveText('Auto (100 %)');
  expect(await page.evaluate(() => localStorage.getItem('ps-replay-interceptor:ui-scale'))).toBeNull();
});
