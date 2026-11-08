import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { test, expect, type Page } from '@playwright/test';
import { Battle, Teams, type PokemonSet } from '@pkmn/sim';
import type { ReplayData } from '@fulllifegames/replay-core';
import { installReplayEmbedCache, routeOfflineFixtures } from './helpers';
import { routeSmogon } from './smogon-routes';

/**
 * Round 88 (F, #101): the stats panel marks the bodies a side never showed. Gen 4 has no team preview, so a game lists the bodies that
 * entered and the log's |teamsize| says the rest: smogtours-gen4ou-544639 shows 3 of P1's 6 (singles), a simulator-made Gen 4 Doubles OU
 * log shows the two leads of each side (doubles). The format's usage file is a slice of the cached Gen 4 OU stats with its teammate lists;
 * the Gen 4 doubles file does not exist, so the doubles game reads the generation's OU file (stage 5 of the build). Each stand-in carries
 * "Not revealed (guessed from teammate usage)"; the shown bodies carry nothing. Written in round 88 and not run there (the integrator
 * ran feedback beside the lane); run it with the lane's Playwright config before the wave merges.
 */
const here = dirname(fileURLToPath(import.meta.url));
const regression = (name: string) => JSON.parse(readFileSync(join(here, '../regression/fixtures', `${name}.json`), 'utf-8'));
const STATS = JSON.stringify(regression('stats-gen4ou-trimmed'));
const MARK = 'Not revealed (guessed from teammate usage)';

test.beforeAll(installReplayEmbedCache);

/** A Gen 4 Doubles OU game nobody played far: six bodies a side, the two leads shown. */
function doublesReplay(): ReplayData {
  const set = (species: string) => ({
    name: species, species, item: '', ability: '', moves: ['tackle'], nature: '', gender: '',
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 100,
  }) as PokemonSet;
  const team = Teams.pack(['Azelf', 'Gyarados', 'Metagross', 'Heatran', 'Latias', 'Tyranitar'].map(set));
  const battle = new Battle({ formatid: 'gen4doublesou' as never, seed: [1, 2, 3, 4], p1: { name: 'Alice', team }, p2: { name: 'Bob', team } });
  battle.makeChoices('default', 'default');
  battle.makeChoices('default', 'default');
  return {
    id: 'gen4doublesou-88101', format: '[Gen 4] Doubles OU', formatid: 'gen4doublesou', players: ['Alice', 'Bob'],
    log: battle.log.join('\n'), uploadtime: 0, views: 0,
  } as unknown as ReplayData;
}

async function loadReplay(page: Page, replay: ReplayData) {
  await routeOfflineFixtures(page);
  await page.goto('/');
  await page.reload();
  // Registered after routeOfflineFixtures, so these answer first: the replay, and the Gen 4 OU file (the doubles file is a 404).
  await page.route('**/replay.pokemonshowdown.com/**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(replay),
  }));
  await routeSmogon(page, route => (route.request().url().includes('/stats/gen4ou.json')
    ? route.fulfill({ status: 200, contentType: 'application/json', body: STATS })
    : route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })));
  await page.locator('input[type="text"]').first().fill(replay.id);
  await page.locator('button', { hasText: 'Load' }).click();
  await expect(page.getByText(replay.players[0], { exact: true }).first()).toBeVisible({ timeout: 15_000 });
}

test('singles: P1 shows 3 of 6 and the panel lists three stand-ins with the marker', async ({ page }) => {
  const replay = regression('smogtours-gen4ou-544639') as ReplayData;
  await loadReplay(page, replay);
  const panel = page.locator('.ps-stats-panel');
  await expect(panel.getByText(MARK)).toHaveCount(3, { timeout: 30_000 });
  await expect(panel.getByRole('img', { name: 'Azelf' })).toHaveCount(1);
  await expect(panel.getByText(/never showed/)).toHaveCount(0);
});

test('doubles: both sides show two of six and the panel lists four stand-ins on each', async ({ page }) => {
  await loadReplay(page, doublesReplay());
  const panel = page.locator('.ps-stats-panel');
  await expect(panel.getByText(MARK)).toHaveCount(8, { timeout: 30_000 });
  await expect(panel.getByText(/never showed/)).toHaveCount(0);
});
