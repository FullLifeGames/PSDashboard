import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { installReplayEmbedCache, routeOfflineFixtures } from './helpers';

test.beforeAll(installReplayEmbedCache);

/**
 * Round 77 (user report 28.10.2026): the Stealth Rock around both Pokémon of 562428 turn 12 showed as empty
 * boxes. graphics.js prefixes the effect sprites with Dex.fxPrefix only when Dex already exists, the embed
 * runs its scripts in any order, and a sprite left as "rock1.png" has no base in the blob document. The
 * document's base names Showdown's fx folder (src/lib/replay-html.ts). The sprites come from the network.
 */
test('the effect sprites of a replay frame load: Stealth Rock at 562428 turn 12', async ({ page }) => {
  test.setTimeout(120_000);
  await routeOfflineFixtures(page);
  const replay = JSON.parse(readFileSync(new URL('../e2e-feedback/fixtures/smogtours-gen8ou-562428.json', import.meta.url), 'utf-8'));
  await page.route('**/replay.pokemonshowdown.com/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(replay) }));
  await page.goto('/');
  await page.locator('input[type="text"]').first().fill('smogtours-gen8ou-562428');
  await page.locator('button', { hasText: 'Load' }).click();
  await page.locator('.ps-branch-bar input[type="range"]').fill('12');
  await expect(page.getByText('T12/')).toBeVisible({ timeout: 30_000 });
  const frame = await (await page.locator('iframe[title="PS Replay"]').elementHandle({ timeout: 10_000 }))?.contentFrame();
  expect(frame).toBeTruthy();
  await expect.poll(async () => frame!.evaluate(() => (window as unknown as { Replays?: { battle?: { turn?: number } } }).Replays?.battle?.turn ?? -1), { timeout: 30_000 }).toBe(12);
  // Both sides carry Stealth Rock here: two rock sprites a side, every one of them loaded from the fx folder.
  await expect.poll(async () => frame!.evaluate(() => [...document.querySelectorAll('img')]
    .filter(image => /rock\d\.png$/.test(image.src))
    .map(image => ({ src: image.src, loaded: image.complete && image.naturalWidth > 0 }))), { timeout: 30_000 })
    .toEqual(expect.arrayContaining([{ src: 'https://play.pokemonshowdown.com/fx/rock1.png', loaded: true }]));
  const rocks = await frame!.evaluate(() => [...document.querySelectorAll('img')].filter(image => /rock\d\.png$/.test(image.src)));
  expect(rocks.length).toBeGreaterThanOrEqual(4);
  const unloaded = await frame!.evaluate(() => [...document.querySelectorAll('img')]
    .filter(image => !(image.complete && image.naturalWidth > 0)).map(image => image.getAttribute('src')));
  expect(unloaded).toEqual([]);
});
