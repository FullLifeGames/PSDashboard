import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { installReplayEmbedCache, routeOfflineFixtures } from './helpers';

test.beforeAll(installReplayEmbedCache);

type StateHandle = { restore: (state: unknown) => Promise<void> };

/**
 * Round 77 (user gate 28.10.2026, 3a): replays a state file from a bug report up to its saved position.
 *   REPRO_STATE=path/to/ps-dashboard-state-….json npm run test:e2e -- test/e2e/repro-state.spec.ts
 * It serves the file's replay to the loader, loads it, restores sets, variation, pointer and drafts, prints
 * what the reporter saw, and stops with a screenshot. A fix copies this test and adds its own assertion.
 */
test('reproduce a reported state', async ({ page }, testInfo) => {
  const file = process.env.REPRO_STATE;
  test.skip(!file, 'set REPRO_STATE=<state file> to reproduce a report');
  test.setTimeout(300_000);
  const state = JSON.parse(readFileSync(file!, 'utf-8'));
  expect(state.kind, 'a PS Dashboard state file').toBe('ps-dashboard-state');

  await routeOfflineFixtures(page);
  const replay = { views: 0, ...state.replay };
  await page.route('**/replay.pokemonshowdown.com/**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(replay),
  }));
  await page.setViewportSize({ width: state.browser?.width ?? 1280, height: state.browser?.height ?? 720 });
  await page.goto('/');
  await page.locator('input[type="text"]').first().fill(replay.id);
  await page.locator('button', { hasText: 'Load' }).click();
  await expect(page.locator('.ps-branch-bar input[type="range"]')).toBeVisible({ timeout: 30_000 });
  await page.evaluate(saved => (window as unknown as { __psState: StateHandle }).__psState.restore(saved), state);
  await page.waitForTimeout(3000);

  const bar = await page.locator('.ps-branch-bar').innerText();
  console.log(`reported: ${state.app.version} (${state.app.commit}), ${state.replay.id}`);
  console.log(`messages then: ${JSON.stringify(state.messages)}`);
  console.log(`timeline now: ${bar.replace(/\n/g, ' ')}`);
  await page.screenshot({ path: testInfo.outputPath('reproduced.png'), fullPage: true });
});
