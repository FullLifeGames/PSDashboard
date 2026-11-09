import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  enrichTeamInfos, inferOpponentTeam, inferReplayFormatId, judgeItemsByDamage, logRules, parseReplayLogWithObservations,
  resolveHiddenPowerType, simFormats, solveReplaySpreads, withStandIns, type OpponentTeamInfo,
} from '@fulllifegames/replay-core';
import { buildReplayTeams, type TeamBuildSources } from '../../src/lib/eval-acquire';
import { replaySolveOptions } from '../../src/lib/team-build-options';
import { appTeamSeed, buildAppTeams } from '../../src/lib/app-team-build';
import { loadReplayMods } from '../../src/lib/replay-mods';
import { generatesTeam, fetchRandomSets } from '../../src/lib/random-sets';
import { fetchSmogonSetAssumptions } from '../../src/lib/smogon-sets';

/**
 * Round 89 (lane B, #117): the app side of the Random Battle fill. The data arrives through the set fetch (the published file, one
 * request per format, cached with the other set data), `buildAppTeams` (the bank's chain) hands it to `withStandIns`, and the build
 * plays six against six. Rows: Gen 3 singles, Gen 9 Random Doubles and both Champions formats, logs the simulator played
 * (packages/replay-core/test/fixtures/random-*.json, with the file entries they read).
 */
interface RandomFixture {
  id: string; formatid: string; log: string;
  teams: { species: string; level: number }[][];
  randomSets: Record<string, { level?: number; roles?: Record<string, { moves?: string[] }>; moves?: string[] }>;
}
const fixture = (id: string) => JSON.parse(readFileSync(`packages/replay-core/test/fixtures/random-${id}.json`, 'utf-8')) as RandomFixture;
const ROWS = [
  { label: 'Gen 3 Random Battle', id: 'gen3randombattle-1', missing: 3 },
  { label: 'Gen 9 Random Doubles Battle', id: 'gen9randomdoublesbattle-11', missing: 2 },
  { label: 'Champions Random Battle', id: 'gen9championsrandombattle-8', missing: 4 },
  { label: 'Champions Random Doubles Battle', id: 'gen9championsrandomdoublesbattle-18', missing: 2 },
] as const;

// The Champions formats read the Champions Dex: the mod registers before any log is read, as the app's replay load does (round 75, T160).
await Promise.all(ROWS.map(row => { const game = fixture(row.id); return loadReplayMods({ log: game.log, formatid: game.formatid }); }));

/** A fetcher that serves the fixture's file for the format's random-set address and a 404 for every other file. */
function fakeFetch(game: RandomFixture, seen: string[] = []) {
  return async (url: string): Promise<Response> => {
    seen.push(url);
    if (new RegExp(`/${game.formatid}\\.json$`).test(url) && /\/(random|randbats\/data)\//.test(url)) {
      return { ok: true, status: 200, json: async () => game.randomSets } as Response;
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  };
}

describe('the fetch', () => {
  const game = fixture('gen3randombattle-1');

  test('a generated-team format loads its random-set file with its set data', async () => {
    const seen: string[] = [];
    const assumptions = await fetchSmogonSetAssumptions({ formatId: game.formatid, species: ['Delibird'], fetcher: fakeFetch(game, seen) as never });
    expect(assumptions?.randomSets).toEqual(game.randomSets);
    expect(seen.some(url => url.endsWith(`/random/${game.formatid}.json`))).toBe(true);
  });

  test('a format that does not generate its team asks for no random-set file', async () => {
    const seen: string[] = [];
    await fetchSmogonSetAssumptions({ formatId: 'gen9ou', species: ['Great Tusk'], fetcher: fakeFetch(game, seen) as never });
    expect(seen.filter(url => /random/.test(url))).toEqual([]);
  });

  test('the second host answers when the first fails; a 404 reads as no file', async () => {
    const hosts: string[] = [];
    const flaky = async (url: string): Promise<Response> => {
      hosts.push(url);
      if (url.startsWith('https://data.pkmn.cc')) throw new Error('Failed to fetch');
      return { ok: true, status: 200, json: async () => game.randomSets } as Response;
    };
    expect(await fetchRandomSets(game.formatid, flaky as never)).toEqual(game.randomSets);
    expect(hosts[0]).toBe(`https://data.pkmn.cc/random/${game.formatid}.json`);
    expect(hosts[1]).toBe(`https://pkmn.github.io/randbats/data/${game.formatid}.json`);
    expect(await fetchRandomSets(game.formatid, (async () => ({ ok: false, status: 404, json: async () => ({}) })) as never)).toBeNull();
  });

  test('the rule is the one withStandIns reads: every Dex format fills with the file exactly when generatesTeam says so', () => {
    const pool = { Pikachu: { level: 80, moves: ['Tackle'] }, Eevee: { level: 80, moves: ['Tackle'] }, Snorlax: { level: 80, moves: ['Tackle'] }, Gengar: { level: 80, moves: ['Tackle'] }, Machamp: { level: 80, moves: ['Tackle'] }, Gyarados: { level: 80, moves: ['Tackle'] }, Alakazam: { level: 80, moves: ['Tackle'] } };
    let compared = 0;
    for (const format of simFormats().all()) {
      if (!format.exists || !format.name.startsWith('[Gen ')) continue;
      const log = ['|gametype|singles', '|player|p1|a|', '|player|p2|b|', `|gen|${format.gen}`, `|tier|${format.name}`, '|teamsize|p1|6', '|teamsize|p2|6', '|start',
        '|switch|p1a: Mew|Mew, L80|100/100', '|switch|p2a: Mewtwo|Mewtwo, L80|100/100', '|turn|1'].join('\n');
      if (inferReplayFormatId({ log }) !== format.id) continue;
      const raw = { p1: inferOpponentTeam(log, 'p1'), p2: inferOpponentTeam(log, 'p2') };
      expect(withStandIns(raw, log, null, undefined, pool) !== raw, format.id).toBe(generatesTeam(format.id));
      compared++;
    }
    expect(compared).toBeGreaterThan(100);
  });
});

describe.each(ROWS)('buildAppTeams: $label', ({ id, missing }) => {
  const game = fixture(id);
  const seed = appTeamSeed(game.log);
  const setAssumptions = { format: game.formatid, source: 'test', pokemon: {}, randomSets: game.randomSets };

  test('today the short side plays short', async () => {
    const app = buildAppTeams(game.log, seed, { usageStats: null, setAssumptions: null });
    expect(app.p1Team).toHaveLength(6 - missing);
    expect(app.p2Team).toHaveLength(6);
  });

  test('with the file both sides play six, the guesses wear the file level and moves', async () => {
    const app = buildAppTeams(game.log, seed, { usageStats: null, setAssumptions });
    expect(app.p1Team).toHaveLength(6);
    expect(app.p2Team).toHaveLength(6);
    const guesses = app.p1Info.pokemon.filter(mon => mon.standIn);
    expect(guesses).toHaveLength(missing);
    for (const mon of guesses) {
      const set = app.p1Team.find(entry => entry.species === mon.species)!;
      expect(set.level).toBe(game.randomSets[mon.species].level);
      const roles = Object.values(game.randomSets[mon.species].roles ?? {});
      const pool = (roles.length ? roles : [game.randomSets[mon.species]]).flatMap(role => role.moves ?? []);
      expect(set.moves.length).toBeGreaterThan(0);
      for (const move of set.moves) expect(pool, `${mon.species} ${move}`).toContain(move);
    }
    // The shown bodies keep their places and the other side is the same object the inference built.
    const names = (info: OpponentTeamInfo) => info.pokemon.map(mon => mon.species);
    expect(names(app.p1Info).slice(0, 6 - missing)).toEqual(names(seed.rawInfos.p1));
    expect(app.p2Info.pokemon.filter(mon => mon.standIn)).toHaveLength(0);
  });
});

describe.each([ROWS[0], ROWS[1]])('the live chain builds what buildAppTeams builds: $label', ({ id }) => {
  test('panel infos with the file, then buildReplayTeams, give the bank\'s sets', async () => {
    const game = fixture(id);
    const seed = appTeamSeed(game.log);
    const parsed = parseReplayLogWithObservations(game.log);
    const hp = (side: 'p1' | 'p2') => (species: string) => resolveHiddenPowerType(
      seed.hpEvidence.filter(entry => entry.attackerSide === side), null, species, logRules(game.log));
    const filled = withStandIns(seed.rawInfos, game.log, null, undefined, game.randomSets);
    const { p1: effectiveP1Info, p2: effectiveP2Info } = enrichTeamInfos(filled, null, null, { p1: hp('p1'), p2: hp('p2') }, judgeItemsByDamage);
    const solved = solveReplaySpreads(game.log, parsed.observations,
      replaySolveOptions({ p1Info: effectiveP1Info, p2Info: effectiveP2Info, usageStats: null, setAssumptions: null, speedOrders: parsed.speedOrders }));
    const sources = {
      teamText: '', effectiveP1Info, effectiveP2Info, usageStats: { stats: null }, setAssumptions: { assumptions: null },
      hpEvidence: seed.hpEvidence, getInferredSpreads: async () => solved,
    } as unknown as TeamBuildSources;
    const replay = { id, format: '', formatid: game.formatid, players: ['a', 'b'], log: game.log, uploadtime: 0, views: 0 };
    const live = await buildReplayTeams(replay as never, sources);
    const app = buildAppTeams(game.log, seed, { usageStats: null, setAssumptions: { format: game.formatid, source: 'test', pokemon: {}, randomSets: game.randomSets } });
    expect(live.p1Team).toHaveLength(6);
    expect(live.p1Team).toEqual(app.p1Team);
    expect(live.p2Team).toEqual(app.p2Team);
  });
});
