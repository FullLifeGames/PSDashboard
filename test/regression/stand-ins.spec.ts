import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { Battle, Teams, type PokemonSet } from '@pkmn/sim';
import {
  enrichTeamInfos, inferOpponentTeam, judgeItemsByDamage, parseReplayLogWithObservations, resolveHiddenPowerType, logRules, solveReplaySpreads,
  withStandIns, buildTeamsFromReplay, type OpponentTeamInfo, type SmogonUsageStats,
} from '@fulllifegames/replay-core';
import { appTeamSeed, buildAppTeams } from '../../src/lib/app-team-build';
import { buildReplayTeams, type TeamBuildSources } from '../../src/lib/eval-acquire';
import { replaySolveOptions } from '../../src/lib/team-build-options';
import { parseSmogonChaosStats } from '../../src/lib/smogon-stats';

/**
 * Round 88 (F, #101): a game without team preview shows only the bodies that entered; `|teamsize|` says how many the side has. A side
 * short of its team size gets stand-ins chosen by the format's teammate statistics, in every build path (the app's panel and live
 * build, `buildAppTeams` of the bank, the builder itself). Scene: smogtours-gen4ou-544639, where P1 shows 3 of 6 in twelve turns and the
 * engine read a 3 against 6 game as a loss at turn 1 (-0.750).
 */
const fixture = (name: string) => JSON.parse(readFileSync(`test/regression/fixtures/${name}.json`, 'utf-8')) as { log: string };
const SCENE = fixture('smogtours-gen4ou-544639').log;
const GEN4 = parseSmogonChaosStats(fixture('stats-gen4ou-trimmed'), { format: 'gen4ou', month: 'latest' }) as SmogonUsageStats;

const speciesOf = (info: OpponentTeamInfo) => info.pokemon.map(mon => mon.species);
const standIns = (info: OpponentTeamInfo) => info.pokemon.filter(mon => mon.standIn);

/** A simulator-made log of a game that nobody played far: both sides have six bodies, two of them shown. */
function simulatorLog(formatid: string, teams: string[]): string {
  const set = (species: string) => ({
    name: species, species, item: '', ability: '', moves: ['tackle'], nature: '', gender: '',
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 100,
  }) as PokemonSet;
  const team = Teams.pack(teams.map(set));
  const battle = new Battle({ formatid: formatid as never, seed: [1, 2, 3, 4], p1: { name: 'a', team }, p2: { name: 'b', team } });
  battle.makeChoices('default', 'default');
  battle.makeChoices('default', 'default');
  return battle.log.join('\n');
}
const SIX = ['Azelf', 'Gyarados', 'Metagross', 'Heatran', 'Latias', 'Tyranitar'];

describe('the scene: P1 shows 3 of 6 in a Gen 4 OU game', () => {
  const seed = appTeamSeed(SCENE);

  test('the raw inference builds three bodies for P1, the stand-in step six', () => {
    expect(speciesOf(seed.rawInfos.p1)).toEqual(['Azelf', 'Gyarados', 'Metagross']);
    const filled = withStandIns(seed.rawInfos, SCENE, GEN4);
    expect(speciesOf(filled.p1).slice(0, 3)).toEqual(['Azelf', 'Gyarados', 'Metagross']);
    expect(filled.p1.pokemon).toHaveLength(6);
    const guessed = standIns(filled.p1);
    expect(guessed).toHaveLength(3);
    const base = guessed.map(mon => mon.species.split('-')[0]);
    expect(new Set([...base, 'Azelf', 'Gyarados', 'Metagross']).size).toBe(6);
    // The greedy sum names bodies the format's statistics list.
    for (const mon of guessed) expect(GEN4.pokemon[mon.species.toLowerCase().replace(/[^a-z0-9]/g, '')]).toBeDefined();
    // P2 showed all six: nothing changes.
    expect(filled.p2).toEqual(seed.rawInfos.p2);
    expect(standIns(filled.p2)).toHaveLength(0);
  });

  test('buildAppTeams gives P1 six sets, the three shown first', () => {
    const app = buildAppTeams(SCENE, seed, { usageStats: GEN4, setAssumptions: null });
    expect(app.p1Team).toHaveLength(6);
    expect(app.p2Team).toHaveLength(6);
    expect(app.p1Team.slice(0, 3).map(set => set.species).sort()).toEqual(['Azelf', 'Gyarados', 'Metagross']);
    expect(standIns(app.p1Info)).toHaveLength(3);
  });

  test('without usage stats a short side stays short', () => {
    const app = buildAppTeams(SCENE, seed, { usageStats: null, setAssumptions: null });
    expect(app.p1Team).toHaveLength(3);
    expect(withStandIns(seed.rawInfos, SCENE, null)).toEqual(seed.rawInfos);
  });

  test('the builder fills a side it infers itself, from the same step', () => {
    expect(buildTeamsFromReplay(SCENE, { usageStats: GEN4 }).p1Team).toHaveLength(6);
    expect(buildTeamsFromReplay(SCENE).p1Team).toHaveLength(3);
  });

  test('the live chain (panel infos, then buildReplayTeams) builds the sets buildAppTeams builds', async () => {
    const parsed = parseReplayLogWithObservations(SCENE);
    const hp = (side: 'p1' | 'p2') => (species: string) => resolveHiddenPowerType(
      seed.hpEvidence.filter(entry => entry.attackerSide === side), GEN4, species, logRules(SCENE));
    const filled = withStandIns(seed.rawInfos, SCENE, GEN4);
    const { p1: effectiveP1Info, p2: effectiveP2Info } = enrichTeamInfos(filled, GEN4, null, { p1: hp('p1'), p2: hp('p2') }, judgeItemsByDamage);
    const solved = solveReplaySpreads(SCENE, parsed.observations,
      replaySolveOptions({ p1Info: effectiveP1Info, p2Info: effectiveP2Info, usageStats: GEN4, setAssumptions: null, speedOrders: parsed.speedOrders }));
    const sources = {
      teamText: '', effectiveP1Info, effectiveP2Info, usageStats: { stats: GEN4 }, setAssumptions: { assumptions: null },
      hpEvidence: seed.hpEvidence, getInferredSpreads: async () => solved,
    } as unknown as TeamBuildSources;
    const replay = { id: 'x', format: '', formatid: 'gen4ou', players: ['a', 'b'], log: SCENE, uploadtime: 0, views: 0 };
    const live = await buildReplayTeams(replay as never, sources);
    const app = buildAppTeams(SCENE, seed, { usageStats: GEN4, setAssumptions: null });
    expect(live.p1Team).toEqual(app.p1Team);
    expect(live.p2Team).toEqual(app.p2Team);
  });
});

describe('a pasted team fills the open slots before any stand-in (user ruling 2)', () => {
  const PASTE = [
    ['Azelf', 'Nasty Plot'], ['Gyarados', 'Dragon Dance'], ['Metagross', 'Meteor Mash'],
    ['Heatran', 'Fire Blast'], ['Scizor', 'Bullet Punch'], ['Dragonite', 'Outrage'],
  ].map(([species, move]) => [`${species} @ Leftovers`, 'Ability: Pressure', `- ${move}`].join('\n')).join('\n\n');
  const bodies = [{ species: 'Heatran' }, { species: 'Scizor' }, { species: 'Dragonite' }, { species: 'Azelf' }];

  test('the three unshown bodies of a six-body paste take the three open slots, and no guess follows', () => {
    const raw = { p1: inferOpponentTeam(SCENE, 'p1'), p2: inferOpponentTeam(SCENE, 'p2') };
    const filled = withStandIns(raw, SCENE, GEN4, { p1: bodies });
    expect(speciesOf(filled.p1)).toEqual(['Azelf', 'Gyarados', 'Metagross', 'Heatran', 'Scizor', 'Dragonite']);
    expect(standIns(filled.p1)).toHaveLength(0);
  });

  test('a paste that lists fewer than the open slots leaves the rest to the stand-ins', () => {
    const raw = { p1: inferOpponentTeam(SCENE, 'p1'), p2: inferOpponentTeam(SCENE, 'p2') };
    const filled = withStandIns(raw, SCENE, GEN4, { p1: [{ species: 'Heatran' }] });
    expect(speciesOf(filled.p1).slice(0, 4)).toEqual(['Azelf', 'Gyarados', 'Metagross', 'Heatran']);
    expect(filled.p1.pokemon).toHaveLength(6);
    expect(standIns(filled.p1)).toHaveLength(2);
  });

  test('the builder builds the pasted bodies with the pasted sets, without any stand-in', () => {
    const { p1Team } = buildTeamsFromReplay(SCENE, { usageStats: GEN4, userTeamText: PASTE });
    expect(p1Team.map(set => set.species)).toEqual(['Azelf', 'Gyarados', 'Metagross', 'Heatran', 'Scizor', 'Dragonite']);
    expect(p1Team[4].moves).toContain('Bullet Punch');
    expect(p1Team[5].moves).toContain('Outrage');
  });
});

describe('doubles: Gen 4 Doubles OU has no team preview either', () => {
  const log = simulatorLog('gen4doublesou', SIX);

  test('the log sizes both sides at six and shows two bodies each', () => {
    expect(log).toContain('|teamsize|p1|6');
    expect(inferOpponentTeam(log, 'p1').pokemon).toHaveLength(2);
  });

  test('every side gets six bodies, the shown two first', () => {
    const raw = { p1: inferOpponentTeam(log, 'p1'), p2: inferOpponentTeam(log, 'p2') };
    const filled = withStandIns(raw, log, GEN4);
    for (const side of ['p1', 'p2'] as const) {
      expect(filled[side].pokemon).toHaveLength(6);
      expect(speciesOf(filled[side]).slice(0, 2)).toEqual(speciesOf(raw[side]));
      expect(standIns(filled[side])).toHaveLength(4);
      expect(new Set(speciesOf(filled[side]).map(name => name.split('-')[0])).size).toBe(6);
    }
  });
});

describe('where the step does nothing', () => {
  const vgc = (teamsize: string) => [
    '|gametype|doubles', '|player|p1|a|', '|player|p2|b|', teamsize, '|gen|9', '|tier|[Gen 9] VGC 2025 Reg I', '|clearpoke',
    ...['p1', 'p2'].flatMap(side => ['Incineroar', 'Rillaboom', 'Flutter Mane', 'Urshifu-Rapid-Strike', 'Amoonguss', 'Tornadus'].map(name => `|poke|${side}|${name}, L50|`)),
    '|teampreview|4', '|start',
    '|switch|p1a: Incineroar|Incineroar, L50|100/100', '|switch|p1b: Rillaboom|Rillaboom, L50|100/100',
    '|switch|p2a: Incineroar|Incineroar, L50|100/100', '|switch|p2b: Rillaboom|Rillaboom, L50|100/100', '|turn|1',
  ].join('\n');

  test('VGC brings 4 of 6 and lists six: the preview side is not short', () => {
    const log = vgc('|teamsize|p1|4\n|teamsize|p2|4');
    const raw = { p1: inferOpponentTeam(log, 'p1'), p2: inferOpponentTeam(log, 'p2') };
    expect(raw.p1.pokemon).toHaveLength(6);
    expect(withStandIns(raw, log, GEN4)).toEqual(raw);
  });

  test('a preview log with a size above the preview list is left alone too', () => {
    const log = vgc('|teamsize|p1|8\n|teamsize|p2|8');
    const raw = { p1: inferOpponentTeam(log, 'p1'), p2: inferOpponentTeam(log, 'p2') };
    expect(withStandIns(raw, log, GEN4)).toEqual(raw);
  });

  test('a log without |teamsize| sizes nothing', () => {
    const log = SCENE.replace(/\|teamsize\|p\d\|\d\n/g, '');
    const raw = { p1: inferOpponentTeam(log, 'p1'), p2: inferOpponentTeam(log, 'p2') };
    expect(withStandIns(raw, log, GEN4)).toEqual(raw);
  });

  test('a generated team (Random Battle) has no stand-ins: the format has no stats file', () => {
    const log = SCENE.replace('|tier|[Gen 4] OU', '|tier|[Gen 4] Random Battle');
    const raw = { p1: inferOpponentTeam(log, 'p1'), p2: inferOpponentTeam(log, 'p2') };
    expect(withStandIns(raw, log, GEN4)).toEqual(raw);
    const gen9 = SCENE.replace('|tier|[Gen 4] OU', '|tier|[Gen 9] Random Battle').replace('|gen|4', '|gen|9');
    const raw9 = { p1: inferOpponentTeam(gen9, 'p1'), p2: inferOpponentTeam(gen9, 'p2') };
    expect(withStandIns(raw9, gen9, GEN4)).toEqual(raw9);
  });

  test('a side that showed its whole team is returned as it came', () => {
    const raw = { p1: inferOpponentTeam(SCENE, 'p1'), p2: inferOpponentTeam(SCENE, 'p2') };
    const filled = withStandIns(raw, SCENE, GEN4);
    expect(filled.p2).toBe(raw.p2);
  });
});
