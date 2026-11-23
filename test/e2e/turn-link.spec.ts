import { test, expect, type Page } from '@playwright/test';
import { expectReplayTurn, installReplayEmbedCache, routeOfflineFixtures } from './helpers';
import { lightEngine } from './dock-helpers';

/**
 * `?replay=<id>&turn=<n>` opens the replay on that turn, as if the user had moved the timeline there: the
 * replay frame shows the turn and the slider stands on it. A turn past the end clamps to the slider's last position, a non-number
 * and a missing `turn` leave the replay on turn 1, and the embedded view (`?embed=1`) reads the same address. A singles replay
 * (the fixture, four turns) and a doubles replay (Doubles OU 2693620934, eight turns).
 */
const SINGLES = 'gen9ou-test-123';
const DOUBLES = 'gen9doublesou-2693620934';

test.beforeAll(installReplayEmbedCache);

test.beforeEach(async ({ page }) => {
  await lightEngine(page);
  await routeOfflineFixtures(page);
});

const slider = (page: Page) => page.locator('.ps-branch-bar input[type="range"]');

async function frameOf(page: Page) {
  const handle = await page.locator('iframe[title="PS Replay"]').elementHandle({ timeout: 15_000 });
  const frame = await handle?.contentFrame();
  expect(frame).toBeTruthy();
  return frame!;
}

for (const [label, id, turn] of [['singles', SINGLES, 3], ['doubles', DOUBLES, 5]] as const) {
  test(`${label}: ?replay=<id>&turn=${turn} opens on turn ${turn}, in the frame and on the timeline`, async ({ page }) => {
    await page.goto(`/?replay=${id}&turn=${turn}`);
    await expect(slider(page)).toBeVisible({ timeout: 15_000 });
    await expect(slider(page)).toHaveValue(String(turn));
    await expectReplayTurn(await frameOf(page), turn);
    // the address still names the replay and how the link opened it
    await expect(page).toHaveURL(new RegExp(`[?&]replay=${id}`));
    await expect(page).toHaveURL(new RegExp(`[?&]turn=${turn}`));
    // the user moves on from there as from any turn
    await slider(page).fill('1');
    await expectReplayTurn(await frameOf(page), 1);
  });

  test(`${label}: the embedded view reads ?turn= too`, async ({ page }) => {
    await page.goto(`/?embed=1&replay=${id}&turn=${turn}`);
    await expect(slider(page)).toBeVisible({ timeout: 15_000 });
    await expect(slider(page)).toHaveValue(String(turn));
    await expectReplayTurn(await frameOf(page), turn);
  });

  test(`${label}: a turn past the end clamps to the last position; a non-number and no turn stay on turn 1`, async ({ page }) => {
    await page.goto(`/?replay=${id}&turn=999`);
    await expect(slider(page)).toBeVisible({ timeout: 15_000 });
    const max = await slider(page).getAttribute('max');
    expect(Number(max)).toBeGreaterThan(turn);
    await expect(slider(page)).toHaveValue(max!);

    for (const query of [`replay=${id}&turn=abc`, `replay=${id}`]) {
      await page.goto('/');
      await page.goto(`/?${query}`);
      await expect(slider(page)).toBeVisible({ timeout: 15_000 });
      await expect(slider(page)).toHaveValue('1');
      await expectReplayTurn(await frameOf(page), 1);
    }
  });
}
