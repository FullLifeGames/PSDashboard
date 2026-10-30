import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { test, expect, type Page } from '@playwright/test';
import type { ReplayData } from '@fulllifegames/replay-core';
import { installReplayEmbedCache, routeOfflineFixtures } from './helpers';

/**
 * Round 79 (T290): the replacement after a knockout, as a note on the card of the next turn. Two real fixtures serve the loader:
 * a Gen 9 OU game in which Toxapex comes in on turn 6 (the card of turn 7 carries the note, the card of turn 6 none) and a
 * Doubles OU game in which Flamigo and Sylveon come in together on turn 2 (one sentence names both slots). A reload serves the
 * note from the stored sweep. The default e2e replay has a knockout the simulator does not reproduce, so it shows no note.
 */

// The e2e specs load as ES modules, which have no __dirname (helpers.ts derives it the same way).
const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(here, '../../packages/eval-engine/test/fixtures', `${name}.json`), 'utf-8')) as ReplayData;

test.beforeAll(installReplayEmbedCache);

async function loadReplay(page: Page, replay: ReplayData) {
  await routeOfflineFixtures(page);
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.setItem('ps-replay-interceptor:eval-pool', '2');
    localStorage.setItem('ps-replay-interceptor:eval-prefs', JSON.stringify({ depth: 1, samples: 1, auto: false, tera: 'auto' }));
  });
  await page.reload();
  // Registered last, so it answers before routeOfflineFixtures' default replay.
  await page.route('**/replay.pokemonshowdown.com/**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(replay),
  }));
  await page.locator('input[type="text"]').first().fill(replay.id);
  await page.locator('button', { hasText: 'Load' }).click();
  await expect(page.getByText(replay.players[0], { exact: true }).first()).toBeVisible({ timeout: 15_000 });
}

const analyzeGame = async (page: Page, timeout = 240_000) => {
  const panel = page.locator('.ps-main-right .ps-eval-panel');
  await panel.locator('button', { hasText: 'Analyze game' }).click();
  await expect(panel.locator('button', { hasText: 'Re-analyze' })).toBeVisible({ timeout });
  return panel;
};

test.describe('the replacement note', () => {
  test('singles: stepping to the turn after the knockout shows what was sent in and what the engine would have sent', async ({ page }) => {
    test.setTimeout(300_000);
    await loadReplay(page, fixture('gen9ou-2658662321'));
    const panel = await analyzeGame(page);
    const slider = page.locator('input[type="range"]');

    await slider.fill('6');
    await expect(panel.locator('.ps-eval-analysis')).toContainText('Turn 6', { timeout: 15_000 });
    await expect(panel.getByText(/^Before turn \d+$/)).toHaveCount(0);

    await slider.fill('7');
    const note = panel.locator('.ps-eval-replacement', { hasText: 'Before turn 7' });
    await expect(note).toBeVisible({ timeout: 15_000 });
    await expect(note).toContainText(/(sent in Toxapex \(\d+%\)\.|had only Toxapex left\.)/);
    // The note sits above the turn card under its own class, and the card keeps its header. Nothing is graded.
    await expect(panel.locator('.ps-eval-analysis')).toContainText('Turn 7');
    await expect(note).not.toContainText(/blunder|mistake|inaccuracy/i);

    // A reload serves the note from the stored sweep.
    await page.reload();
    await page.locator('input[type="text"]').first().fill('gen9ou-2658662321');
    await page.locator('button', { hasText: 'Load' }).click();
    await expect(page.getByText(fixture('gen9ou-2658662321').players[0], { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await analyzeGame(page, 90_000);
    await page.locator('input[type="range"]').fill('7');
    await expect(page.locator('.ps-main-right .ps-eval-panel .ps-eval-replacement', { hasText: 'Before turn 7' })).toContainText('Toxapex', { timeout: 15_000 });
  });

  test('doubles: two replaced slots of one side read as one sentence with both Pokémon', async ({ page }) => {
    test.setTimeout(300_000);
    await loadReplay(page, fixture('gen9doublesou-2694811367'));
    const panel = await analyzeGame(page);
    await page.locator('input[type="range"]').fill('3');
    const note = panel.locator('.ps-eval-replacement', { hasText: 'Before turn 3' });
    await expect(note).toBeVisible({ timeout: 15_000 });
    await expect(note).toContainText(/Flamigo and Sylveon|Sylveon and Flamigo/);
    await expect(note).not.toContainText(/blunder|mistake|inaccuracy/i);
  });
});
