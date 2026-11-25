import { test, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { loadSimMods } from '@fulllifegames/eval-engine';
import { join } from 'path';
import { FEEDBACK_CENSUS_REPLAYS, FEEDBACK_CORPUS, FEEDBACK_REPLAYS } from '../e2e-feedback/corpus';
import { validateCorpus } from '../e2e-feedback/claims';
import {
  parseReplayLogWithObservations, finalPlayedTurn, buildTeamsFromReplay, getReplayGameType, replayBringOnly,
} from '@fulllifegames/replay-core';
import { fetchSmogonSetAssumptions } from '../../src/lib/smogon-sets';
import { fetchSmogonUsageStats } from '../../src/lib/smogon-stats';

test('feedback fixtures parse and cover every corpus turn', () => {
  const turnsByReplay: Record<string, number> = {};
  for (const id of FEEDBACK_REPLAYS) {
    const replay = JSON.parse(readFileSync(join('test', 'e2e-feedback', 'fixtures', `${id}.json`), 'utf-8')) as { id: string; log: string; players: string[] };
    expect(replay.id).toBe(id);
    expect(replay.players.length).toBeGreaterThanOrEqual(2);
    const { snapshots } = parseReplayLogWithObservations(replay.log);
    expect(snapshots.length).toBeGreaterThan(0);
    turnsByReplay[id] = finalPlayedTurn(snapshots);
    expect(turnsByReplay[id]).toBeGreaterThanOrEqual(10);
  }
  expect(validateCorpus(FEEDBACK_CORPUS, turnsByReplay, false)).toEqual([]);
});

test('573756: the lethal-aware fit drops the knock-out bias on both sides', () => {
  const replay = JSON.parse(readFileSync(join('test', 'e2e-feedback', 'fixtures', 'smogtours-gen8ou-573756.json'), 'utf-8')) as { log: string };
  const { observations, speedOrders } = parseReplayLogWithObservations(replay.log);
  const { p1Team, p2Team } = buildTeamsFromReplay(replay.log, { observations, speedOrders });
  const toxapex = p1Team.find(set => set.species === 'Toxapex');
  expect(toxapex).toBeTruthy();
  expect(toxapex!.nature === 'Bold' && toxapex!.evs.def === 252).toBe(false);
  const melmetal = p2Team.find(set => set.species === 'Melmetal');
  expect(melmetal).toBeTruthy();
  expect(melmetal!.evs.atk).toBe(252);
});

const fixtureFetcher = async (url: string) => {
  const path = url.replace(/^https:\/\/(data\.pkmn\.cc|pkmn\.github\.io\/smogon\/data)/, '').replace(/\/{2,}/g, '/');
  const file = join('test', 'e2e-feedback', 'fixtures', 'smogon', `${path.replace(/[^a-z0-9.]+/gi, '_')}.json`);
  if (!existsSync(file)) return { ok: false, status: 404, json: async () => { throw new Error('404'); } } as unknown as Response;
  return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(file, 'utf-8')) } as unknown as Response;
};

test('573756: the set fixtures feed the curated Toxapex and Corviknight sets', async () => {
  for (const name of ['_sets_gen6ou.json.json', '_sets_gen8ou.json.json']) {
    expect(existsSync(join('test', 'e2e-feedback', 'fixtures', 'smogon', name))).toBe(true);
  }
  const replay = JSON.parse(readFileSync(join('test', 'e2e-feedback', 'fixtures', 'smogtours-gen8ou-573756.json'), 'utf-8')) as { log: string };
  const { observations, speedOrders } = parseReplayLogWithObservations(replay.log);
  const setAssumptions = await fetchSmogonSetAssumptions({ formatId: 'gen8ou', species: ['Toxapex', 'Corviknight'], fetcher: fixtureFetcher as never });
  const { p1Team } = buildTeamsFromReplay(replay.log, { observations, speedOrders, setAssumptions });
  const toxapex = p1Team.find(set => set.species === 'Toxapex')!;
  expect(toxapex.evs.hp).toBe(248);
  expect(toxapex.evs.spd).toBeGreaterThanOrEqual(240);
  expect(toxapex.evs.spd).toBeGreaterThan(toxapex.evs.def);
  const corviknight = p1Team.find(set => set.species === 'Corviknight')!;
  expect([corviknight.evs.hp, corviknight.evs.def, corviknight.evs.spd]).toEqual([248, 136, 124]);
});

test('573756: Magnezone holds the Choice Scarf the move order proves', async () => {
  const replay = JSON.parse(readFileSync(join('test', 'e2e-feedback', 'fixtures', 'smogtours-gen8ou-573756.json'), 'utf-8')) as { log: string };
  const { observations, speedOrders } = parseReplayLogWithObservations(replay.log);
  const usageStats = await fetchSmogonUsageStats('gen8ou', { fetcher: fixtureFetcher as never });
  const { p1Team } = buildTeamsFromReplay(replay.log, { observations, speedOrders, usageStats });
  const magnezone = p1Team.find(set => set.species === 'Magnezone')!;
  expect(magnezone.item).toBe('Choice Scarf');
  expect(magnezone.nature).toBe('Timid');
  expect(magnezone.evs.spe).toBe(252);
});

const SINGLES_CENSUS: readonly string[] = ['gen9championsou-2628340185'];

test('census fixtures are doubles games (Champions OU singles) with every Smogon input pinned', async () => {
  await loadSimMods('gen9championsou');
  expect(FEEDBACK_CENSUS_REPLAYS.filter(id => (FEEDBACK_REPLAYS as readonly string[]).includes(id))).toEqual([]);
  expect(FEEDBACK_CORPUS.filter(item => (FEEDBACK_CENSUS_REPLAYS as readonly string[]).includes(item.replay))).toEqual([]);
  for (const id of FEEDBACK_CENSUS_REPLAYS) {
    const replay = JSON.parse(readFileSync(join('test', 'e2e-feedback', 'fixtures', `${id}.json`), 'utf-8')) as {
      id: string; log: string; players: string[]; formatid: string;
    };
    expect(replay.id).toBe(id);
    expect(replay.players.length).toBeGreaterThanOrEqual(2);
    expect(getReplayGameType(replay.log)).toBe(SINGLES_CENSUS.includes(id) ? 'singles' : 'doubles');
    const { snapshots, observations, speedOrders } = parseReplayLogWithObservations(replay.log);
    expect(finalPlayedTurn(snapshots)).toBeGreaterThanOrEqual(10);
    if (replay.formatid.includes('vgc')) {
      const bring = replayBringOnly(replay, snapshots);
      expect([bring?.p1.length, bring?.p2.length]).toEqual([4, 4]);
    }

    const unpinned: string[] = [];
    const pinnedFetcher = async (url: string) => {
      const path = url.replace(/^https:\/\/(data\.pkmn\.cc|pkmn\.github\.io\/smogon\/data)/, '').replace(/\/{2,}/g, '/');
      const key = join('test', 'e2e-feedback', 'fixtures', 'smogon', path.replace(/[^a-z0-9.]+/gi, '_'));
      if (!existsSync(`${key}.json`) && !existsSync(`${key}.404`)) unpinned.push(path);
      return fixtureFetcher(url);
    };
    const usageStats = await fetchSmogonUsageStats(replay.formatid, { fetcher: pinnedFetcher as never });
    const { p1Team, p2Team } = buildTeamsFromReplay(replay.log, { observations, speedOrders, usageStats });
    expect(Math.min(p1Team.length, p2Team.length)).toBeGreaterThan(0);
    const species = [...new Set([...p1Team, ...p2Team].map(set => set.species))];
    await fetchSmogonSetAssumptions({ formatId: replay.formatid, species, fetcher: pinnedFetcher as never });
    expect(unpinned).toEqual([]);
  }
});
