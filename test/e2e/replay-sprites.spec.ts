import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { installReplayEmbedCache, routeOfflineFixtures, type ReplayWindow } from './helpers';

test.beforeAll(installReplayEmbedCache);

/**
 * Round 77 (branching swarm, 28.10.2026): a cold first load left the frame empty with "$ is not defined".
 * replay-embed.js appends its sixteen scripts as dynamic scripts, and those run in the order they arrive:
 * graphics.js extends $.easing at load time, stops halfway when jQuery comes later, BattleBackdrops stays
 * undefined, and the battle never builds. Here jQuery arrives after graphics.js on purpose.
 */
test('the replay frame builds when jQuery arrives after graphics.js', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await routeOfflineFixtures(page);
  let graphicsArrived!: () => void;
  const graphics = new Promise<void>(resolve => { graphicsArrived = resolve; });
  page.on('requestfinished', request => { if (/\/data\/graphics\.js/.test(request.url())) graphicsArrived(); });
  await page.route('**/play.pokemonshowdown.com/js/lib/jquery-1.11.0.min.js', async route => {
    await graphics;
    await new Promise(resolve => setTimeout(resolve, 500));
    await route.continue();
  });
  await page.goto('/');
  await page.locator('button', { hasText: 'Load' }).click();
  const frame = await (await page.locator('iframe[title="PS Replay"]').elementHandle({ timeout: 30_000 }))?.contentFrame();
  expect(frame).toBeTruthy();
  await expect.poll(async () => frame!.evaluate(() => !!(window as ReplayWindow).Replays?.battle), { timeout: 45_000 }).toBe(true);
  expect(errors.filter(message => /is not defined|Cannot read properties of undefined/.test(message))).toEqual([]);
});

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
  // An animated Pokémon sprite (65 kB) may still be on its way when the rocks are in: wait for it, then require all.
  await expect.poll(async () => frame!.evaluate(() => [...document.querySelectorAll('img')]
    .filter(image => !(image.complete && image.naturalWidth > 0)).map(image => image.getAttribute('src'))), { timeout: 30_000 })
    .toEqual([]);
});
