import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { test, expect, type Page } from '@playwright/test';
import { Battle, Teams, type PokemonSet } from '@pkmn/sim';
import type { ReplayData } from '@fulllifegames/replay-core';
import { installReplayEmbedCache, openTray, routeOfflineFixtures, waitForExactPickers } from './helpers';
import { routeSmogon } from './smogon-routes';

// Gen 4 has no team preview: the log's |teamsize| says how many bodies a side has beyond the ones that entered.
const here = dirname(fileURLToPath(import.meta.url));
const regression = (name: string) => JSON.parse(readFileSync(join(here, '../regression/fixtures', `${name}.json`), 'utf-8'));
const STATS = JSON.stringify(regression('stats-gen4ou-trimmed'));
const MARK = 'Not revealed (guessed from teammate usage)';

test.beforeAll(installReplayEmbedCache);

function doublesReplay(p1Switch = false): ReplayData {
  const set = (species: string) => ({
    name: species, species, item: '', ability: '', moves: ['tackle'], nature: '', gender: '',
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 100,
  }) as PokemonSet;
  const team = Teams.pack(['Azelf', 'Gyarados', 'Metagross', 'Heatran', 'Latias', 'Tyranitar'].map(set));
  const battle = new Battle({ formatid: 'gen4doublesou' as never, seed: [1, 2, 3, 4], p1: { name: 'Alice', team }, p2: { name: 'Bob', team } });
  battle.makeChoices('default', 'default');
  battle.makeChoices(p1Switch ? 'switch 3, move 1 1' : 'default', 'default');
  return {
    id: p1Switch ? 'gen4doublesou-88102' : 'gen4doublesou-88101', format: '[Gen 4] Doubles OU', formatid: 'gen4doublesou', players: ['Alice', 'Bob'],
    log: battle.log.join('\n'), uploadtime: 0, views: 0,
  } as unknown as ReplayData;
}

async function loadReplay(page: Page, replay: ReplayData) {
  await routeOfflineFixtures(page);
  await page.goto('/');
  await page.reload();
  // Registered after routeOfflineFixtures, so these answer first; the Gen 4 doubles usage file is a 404.
  await page.route('**/replay.pokemonshowdown.com/**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(replay),
  }));
  await routeSmogon(page, route => (route.request().url().includes('/stats/gen4ou.json')
    ? route.fulfill({ status: 200, contentType: 'application/json', body: STATS })
    : route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })));
  await page.locator('input[type="text"]').first().fill(replay.id);
  await page.locator('button', { hasText: /^(Load|Game)( ▾)?$/ }).click();
  await expect(page.getByText(replay.players[0], { exact: true }).first()).toBeVisible({ timeout: 15_000 });
}

test('doubles: both sides show two of six and the panel lists four stand-ins on each', async ({ page }) => {
  await loadReplay(page, doublesReplay());
  const panel = page.locator('.ps-stats-panel');
  await expect(panel.getByText(MARK)).toHaveCount(8, { timeout: 30_000 });
  await expect(panel.getByText(/never showed/)).toHaveCount(0);
});

async function expectBenchBadges(page: Page) {
  const panel = page.locator('.ps-stats-panel');
  await expect(panel.getByText(MARK).first()).toBeVisible({ timeout: 30_000 });
  const standIns = (await panel.locator('.ps-stats-team').first().locator('.ps-stats-details', { has: page.locator('.ps-stats-standin') }).locator('.ps-stats-species').allInnerTexts())
    .map(text => text.replace(/\s+L\d+.*$/s, '').trim());
  expect(standIns.length).toBeGreaterThan(0);
  await waitForExactPickers(page);
  const tray = await openTray(page, 'p1a');
  const tiles = tray.locator('.ps-switchbtn');
  await expect(tiles.first()).toBeVisible({ timeout: 30_000 });
  const seen: { name: string; badge: number }[] = [];
  for (const tile of await tiles.all()) {
    seen.push({ name: (await tile.locator('img').getAttribute('alt')) ?? '', badge: await tile.locator('.ps-guess-badge').count() });
  }
  const badged = seen.filter(tile => tile.badge === 1).map(tile => tile.name);
  const plain = seen.filter(tile => tile.badge === 0).map(tile => tile.name);
  expect(badged.length, `badged tiles of ${JSON.stringify(seen)}`).toBeGreaterThan(0);
  for (const name of badged) expect(standIns, `${name} wears the badge`).toContain(name);
  expect(plain.length, `unbadged tiles of ${JSON.stringify(seen)}`).toBeGreaterThan(0);
  for (const name of plain) expect(standIns, `${name} wears no badge`).not.toContain(name);
}

test('singles: P1 shows 3 of 6, the panel marks three stand-ins, and the What-if bench badges the stand-ins and no shown body', async ({ page }) => {
  await loadReplay(page, regression('smogtours-gen4ou-544639') as ReplayData);
  const panel = page.locator('.ps-stats-panel');
  await expect(panel.getByText(MARK)).toHaveCount(3, { timeout: 30_000 });
  await expect(panel.getByRole('img', { name: 'Azelf' })).toHaveCount(1);
  await expect(panel.getByText(/never showed/)).toHaveCount(0);
  await expectBenchBadges(page);
});

test('doubles: the What-if bench badges the stand-ins and no shown body', async ({ page }) => {
  await loadReplay(page, doublesReplay(true));
  await expectBenchBadges(page);
});
