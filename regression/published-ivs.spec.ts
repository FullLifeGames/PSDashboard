import { test, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { appTeamSeed, buildAppTeams } from '../src/lib/app-team-build';
import { fetchSmogonSetAssumptions } from '../src/lib/smogon-sets';
import { fetchSmogonUsageStats } from '../src/lib/smogon-stats';

/**
 * The build plays the IVs a published Smogon set lists (round 64, T122
 * point 4, spec decision 21): the Trick Room Sinistcha of 2663093831 runs
 * Speed 0 and Attack 0, the specially defensive Toxapex of 573756 Attack 0.
 * Data: the feedback harness's fixtures, served as hermetic.ts serves them.
 */
const fixtureFetcher = async (url: string) => {
  const path = url.replace(/^https:\/\/(data\.pkmn\.cc|pkmn\.github\.io\/smogon\/data)/, '').replace(/\/{2,}/g, '/');
  const file = join('e2e-feedback', 'fixtures', 'smogon', `${path.replace(/[^a-z0-9.]+/gi, '_')}.json`);
  if (!existsSync(file)) return { ok: false, status: 404, json: async () => { throw new Error('404'); } } as unknown as Response;
  return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(file, 'utf-8')) } as unknown as Response;
};

async function built(id: string) {
  const replay = JSON.parse(readFileSync(join('e2e-feedback', 'fixtures', `${id}.json`), 'utf-8')) as { log: string; formatid?: string };
  const seed = appTeamSeed(replay.log);
  const formatId = replay.formatid ?? id;
  const usageStats = await fetchSmogonUsageStats(formatId, { fetcher: fixtureFetcher as never });
  const setAssumptions = await fetchSmogonSetAssumptions({ formatId, species: seed.species, fetcher: fixtureFetcher as never });
  return buildAppTeams(replay.log, seed, { usageStats, setAssumptions });
}

test('doubles, 2663093831: the Trick Room Sinistcha runs the published Speed 0 and Attack 0', async () => {
  const teams = await built('gen9doublesou-2663093831');
  for (const team of [teams.p1Team, teams.p2Team]) {
    const sinistcha = team.find(set => set.species === 'Sinistcha');
    expect(sinistcha?.ivs).toEqual({ hp: 31, atk: 0, def: 31, spa: 31, spd: 31, spe: 0 });
  }
});

test('singles, 573756: the specially defensive Toxapex runs the published Attack 0, its foe Toxapex keeps 31', async () => {
  const teams = await built('smogtours-gen8ou-573756');
  expect(teams.p1Team.find(set => set.species === 'Toxapex')?.ivs).toEqual({ hp: 31, atk: 0, def: 31, spa: 31, spd: 31, spe: 31 });
});
