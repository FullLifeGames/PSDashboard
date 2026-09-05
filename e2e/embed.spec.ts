import { test, expect } from '@playwright/test';
import { encodeBranchShare } from '../src/lib/branch-share';
import { sharedBranchPayload } from './fixtures/shared-branch';
import { installReplayEmbedCache, routeOfflineFixtures, startVariationAt, type ReplayWindow } from './helpers';

test.beforeAll(installReplayEmbedCache);

test.describe('PS Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await routeOfflineFixtures(page);
    await page.goto('/');
  });

  test('auto-loads a replay from the ?replay query parameter', async ({ page }) => {
    await page.goto('/?replay=gen9ou-test-123');
    await expect(page.getByText('TestPlayer1', { exact: true }).first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('iframe[title="PS Replay"]')).toBeVisible({ timeout: 10000 });
  });

  test('embed mode hides the app chrome and waits for a host replay', async ({ page }) => {
    await page.goto('/?embed=1');
    await expect(page.getByText(/waiting for a replay/i)).toBeVisible();
    await expect(page.locator('h1')).toHaveCount(0);
  });

  test('embed mode loads replays posted by the host page', async ({ page }) => {
    await page.goto('/?embed=1');
    await expect(page.getByText(/waiting for a replay/i)).toBeVisible();
    await page.evaluate(() => window.postMessage({ type: 'ps-load-replay', replay: 'gen9ou-test-123' }, '*'));

    await expect(page.getByText('TestPlayer1', { exact: true }).first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('iframe[title="PS Replay"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('h1')).toHaveCount(0);
  });

  test('a replay injected while branching replaces the branch cleanly', async ({ page }) => {
    await page.locator('button', { hasText: 'Load' }).click();
    await startVariationAt(page, 1);
    await expect(page.getByText(/Branching · Turn/)).toBeVisible({ timeout: 15000 });

    await page.evaluate(() => window.postMessage({ type: 'ps-load-replay', replay: 'gen9doubles-test' }, '*'));

    await expect(page.getByText('Alice', { exact: true }).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/Branching · Turn/)).toHaveCount(0);
    await expect(page.locator('iframe[title="PS Replay"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.ps-branch-bar input[type="range"]')).toBeVisible();
  });

  test('a ?p2 replay link loads the p2 perspective', async ({ page }) => {
    await page.getByLabel('Replay URL or ID').fill('https://replay.pokemonshowdown.com/gen9ou-123?p2');
    await page.locator('button', { hasText: 'Load' }).click();
    const iframeHandle = await page.locator('iframe[title="PS Replay"]').elementHandle({ timeout: 10000 });
    const frame = await iframeHandle?.contentFrame();
    expect(frame).toBeTruthy();

    await expect.poll(async () => frame!.evaluate(() =>
      (window as ReplayWindow).Replays?.battle?.viewpointSwitched ?? false
    ), { timeout: 30_000 }).toBe(true);
    // The mirrored loader link keeps the perspective flag.
    await expect(page.getByLabel('Replay URL or ID')).toHaveValue(/\?p2$/);
  });

  test('opens shared branch links as a replayable read-only branch', async ({ page }) => {
    const encoded = encodeBranchShare(sharedBranchPayload);
    await page.goto(`/#branch=${encoded}`);

    await expect(page.getByText('Shared Branch')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('iframe[title="Shared Branch Replay"]')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Turn 2: P1 move 1 / P2 move 2')).toBeVisible();

    await page.locator('button', { hasText: 'Load Original Replay' }).click();
    await expect(page.locator('iframe[title="PS Replay"]')).toBeVisible({ timeout: 10000 });
  });
});
