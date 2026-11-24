import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import type { ReplayData } from '@fulllifegames/replay-core';
import { dockReplays, fixturePath, installReplayEmbedCache, moveTimeline, routeOfflineFixtures } from './helpers';
import { lightEngine } from './dock-helpers';

const winnerOf = (log: string) => log.match(/\|win\|(.+)/)![1].trim();
const singles = JSON.parse(readFileSync(fixturePath('interlude-singles-752301.json'), 'utf-8')) as ReplayData;
const CASES = [
  { name: 'singles', replay: singles },
  { name: 'doubles', replay: dockReplays.find(replay => replay.id === 'gen9doublesou-2693620934')! },
];

test.beforeAll(installReplayEmbedCache);

test.beforeEach(async ({ page }) => {
  await lightEngine(page);
  await routeOfflineFixtures(page);
  await page.route(`**/replay.pokemonshowdown.com/**${singles.id}**`, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(singles) }));
  await page.goto('/');
});

for (const { name, replay } of CASES) {
  test(`${name}: the end of the replay names the winner and offers no picker`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.locator('input[type="text"]').fill(replay.id);
    await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
    const slider = page.locator('.ps-branch-bar input[type="range"]');
    await expect(slider).toBeVisible({ timeout: 60_000 });
    const max = Number(await slider.getAttribute('max'));
    await moveTimeline(page, max);
    await expect(page.locator('.ps-dock')).toContainText(`${winnerOf(replay.log)} won the battle!`, { timeout: 60_000 });
    await expect(page.locator('.ps-dock-chip')).toHaveCount(0);
    await expect(page.locator('.ps-execute-btn')).toHaveCount(0);
    await moveTimeline(page, max - 1);
    await expect(page.locator('.ps-dock-chip').first()).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.ps-dock')).not.toContainText('won the battle!');
  });
}
