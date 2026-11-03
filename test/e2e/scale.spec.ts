import { test, expect, type Page } from '@playwright/test';
import { dockChip, dockTray, installReplayEmbedCache, routeOfflineFixtures } from './helpers';
import { Clicks, failOnResizeLoops, lightEngine, loadDockReplay, variationPanel } from './dock-helpers';

/**
 * Round 84 (T315, A7d, spec addendum A): the app grows with large windows. At 2560 x 1290 Auto takes 150 %: the app fills the window
 * (the vh rules divide by the scale), the left column does not scroll, the replay frame's content scales with the app (Chromium
 * carries the root's zoom into the frame, WebKit needs the frame follower), the timeline slider's pointer lands where it shows, and
 * the task of criterion 1 (a move instead of the played one: chip, tile, Execute) takes the same three clicks. The setting
 * overrides Auto, persists across a reload, and a step that leaves the app less than 1050 px is disabled and says why.
 */
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
  // The app fills the window and no more: a vh rule left undivided would reach 1.5 times the window.
  expect(Math.abs(facts.appHeight - facts.innerHeight), `height of the app ${JSON.stringify(facts)}`).toBeLessThanOrEqual(2);
  expect(facts.pageOverflow, 'the page does not scroll').toBeLessThanOrEqual(1);
  expect(facts.leftOverflow, 'the left column does not scroll').toBeLessThanOrEqual(1);
  expect(facts.leftScrollTop).toBe(0);
  expect(facts.frameVisual / facts.frameCss, 'the frame element\'s scale').toBeCloseTo(1.5, 1);
  // The replay's content scales with the frame, drawn at the zoomed size: its 642 px battle stands 963 px wide on the screen and
  // inside the frame. In WebKit a frame that kept its 100 % layout shows it at 642.
  const frame = (await page.locator('.ps-iframe-wrap iframe').first().boundingBox())!;
  const battle = frameOf(page).locator('.battle');
  await expect(battle).toBeVisible({ timeout: 60_000 });
  const box = (await battle.boundingBox())!;
  expect(box.width, `width of the battle on the screen ${JSON.stringify({ box, frame })}`).toBeGreaterThan(BATTLE_WIDTH * 1.5 - 6);
  expect(box.width).toBeLessThan(BATTLE_WIDTH * 1.5 + 6);
  expect(box.x).toBeGreaterThanOrEqual(frame.x - 1);
  expect(box.x + box.width).toBeLessThanOrEqual(frame.x + frame.width + 1);
});

test('the timeline slider lands where the pointer shows at 150 %', async ({ page }) => {
  test.setTimeout(120_000);
  await loadDockReplay(page, DOUBLES, TURN);
  expect(await rootScale(page)).toBe('1.5');
  const slider = page.locator('.ps-branch-bar input[type="range"]');
  const range = await slider.evaluate(input => ({ min: Number((input as HTMLInputElement).min), max: Number((input as HTMLInputElement).max) }));
  const box = (await slider.boundingBox())!;
  // The box is in screen pixels (150 % of its CSS size); a click at its middle reads half the range if the pointer hits what is shown.
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

test('the Size setting overrides Auto, persists across a reload, and disables a step that leaves under 1050 px', async ({ page }) => {
  test.setTimeout(180_000);
  await loadDockReplay(page, DOUBLES, TURN);
  let size = await openSetup(page);
  await expect(size).toHaveValue('auto');
  await expect(size.locator('option').first()).toHaveText('Auto (150 %)');
  expect(await rootScale(page)).toBe('1.5');

  // A step overrides Auto, at once: 100 % is the app's own size (no factor written), 200 % doubles it.
  await size.selectOption({ value: '1' });
  expect(await rootScale(page)).toBe('');
  expect(Math.abs((await page.locator('.ps-app-root').boundingBox())!.height - 1290)).toBeLessThanOrEqual(2);
  await size.selectOption({ value: '2' });
  expect(await rootScale(page)).toBe('2');
  expect(Math.abs((await page.locator('.ps-app-root').boundingBox())!.height - 1290)).toBeLessThanOrEqual(2);

  // The choice persists across a reload: the root carries it before anything renders, and the select shows it.
  await page.reload();
  expect(await rootScale(page)).toBe('2');
  await loadDockReplay(page, DOUBLES, TURN);
  size = await openSetup(page);
  await expect(size).toHaveValue('2');

  // A narrower window disables the steps that would leave under 1050 px (1600 / 1.75 = 914) and holds the chosen 200 % back to 150 %.
  await page.setViewportSize({ width: 1600, height: 1000 });
  await expect(size.locator('option', { hasText: /^175 %/ })).toBeDisabled();
  await expect(size.locator('option', { hasText: /^200 %/ })).toBeDisabled();
  await expect(size.locator('option', { hasText: /^175 %/ })).toHaveText('175 % (needs a window at least 1838 px wide)');
  await expect(size.locator('option', { hasText: /^150 %/ })).toBeEnabled();
  await expect.poll(() => rootScale(page)).toBe('1.5');

  // Auto takes the choice back: this window gives 100 %.
  await size.selectOption({ value: 'auto' });
  expect(await rootScale(page)).toBe('');
  await expect(size.locator('option').first()).toHaveText('Auto (100 %)');
  expect(await page.evaluate(() => localStorage.getItem('ps-replay-interceptor:ui-scale'))).toBeNull();
});
