import { test, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { appTeamSeed, buildAppTeams } from '../../src/lib/app-team-build';
import { fetchSmogonSetAssumptions } from '../../src/lib/smogon-sets';
import { fetchSmogonUsageStats } from '../../src/lib/smogon-stats';

const fixtureFetcher = async (url: string) => {
  const path = url.replace(/^https:\/\/(data\.pkmn\.cc|pkmn\.github\.io\/smogon\/data)/, '').replace(/\/{2,}/g, '/');
  const file = join('test', 'e2e-feedback', 'fixtures', 'smogon', `${path.replace(/[^a-z0-9.]+/gi, '_')}.json`);
  if (!existsSync(file)) return { ok: false, status: 404, json: async () => { throw new Error('404'); } } as unknown as Response;
  return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(file, 'utf-8')) } as unknown as Response;
};

async function built(id: string) {
  const replay = JSON.parse(readFileSync(join('test', 'e2e-feedback', 'fixtures', `${id}.json`), 'utf-8')) as { log: string; formatid?: string };
  const seed = appTeamSeed(replay.log);
  const formatId = replay.formatid ?? id;
  const usageStats = await fetchSmogonUsageStats(formatId, { fetcher: fixtureFetcher as never });
  const setAssumptions = await fetchSmogonSetAssumptions({ formatId, species: seed.species, fetcher: fixtureFetcher as never });
  return buildAppTeams(replay.log, seed, { usageStats, setAssumptions });
}

test('doubles, 2663093831: the Trick Room Sinistcha keeps the published Attack 0, and p1 gets Speed 31 back where the log refutes 0', async () => {
  // Turn 8: Sinistcha outspeeds Incineroar without Trick Room, which Speed IV 0 cannot keep: solver restores 31.
  const teams = await built('gen9doublesou-2663093831');
  expect(teams.p1Team.find(set => set.species === 'Sinistcha')?.ivs).toEqual({ hp: 31, atk: 0, def: 31, spa: 31, spd: 31, spe: 31 });
  expect(teams.p2Team.find(set => set.species === 'Sinistcha')?.ivs).toEqual({ hp: 31, atk: 0, def: 31, spa: 31, spd: 31, spe: 0 });
});

test('singles, 573756: the specially defensive Toxapex runs the published Attack 0, its foe Toxapex keeps 31', async () => {
  const teams = await built('smogtours-gen8ou-573756');
  expect(teams.p1Team.find(set => set.species === 'Toxapex')?.ivs).toEqual({ hp: 31, atk: 0, def: 31, spa: 31, spd: 31, spe: 31 });
});
