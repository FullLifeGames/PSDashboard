import './champions-mod';
import { test, expect, describe } from 'vitest';
import { Battle, Teams, toID, type PokemonSet, Dex } from '@pkmn/sim';
import { calculate, Field, Generations, Move, Pokemon } from '@smogon/calc';
import { inferOpponentTeam } from '../src/opponent-inferrer';
import { judgeItemsByDamage } from '../src/team/item-damage';
import { guessedEvs, guessedField, revealedField, unknownField, enrichTeamInfo } from '../src/team-info';
import type { LoggedHit, OpponentTeamInfo, PokemonEvs, RevealedPokemonInfo, DamageObservation } from '../src/types';
import * as championsMod from '@pkmn/mods/champions';
import { calcGenerationFor, calcModOf } from '../src/calc-gen';
import { buildSolveContext, observationError } from '../src/spreads/fit';
import { enrichTeamInfos } from '../src/team/damage-ruleouts';
import { buildTeamsFromReplay } from '../src/team-builder';
import type { PokemonSetAssumption, SetAssumption, SmogonSetAssumptions } from '../src/smogon/sets-lookup';
import type { PokemonUsageStats, SmogonUsageStats } from '../src/smogon/stats-types';
import { toId } from '../src/ids';

function set(species: string, item: string, ability: string, moves: string[], spread: { nature: string; evs: Partial<PokemonEvs> }, teraType?: string): PokemonSet {
  return {
    name: species, species, item, ability, moves, nature: spread.nature, level: 100, gender: '', teraType,
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...spread.evs },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  } as PokemonSet;
}

function play(p1: PokemonSet[], p2: PokemonSet[], turns: [string, string][], doubles = false, format = 'ou'): string {
  const battle = new Battle({
    formatid: toID(doubles ? `gen9doubles${format}` : `gen9${format}`), seed: '1,2,3,4',
    p1: { name: 'Alpha', team: Teams.pack(p1) }, p2: { name: 'Beta', team: Teams.pack(p2) },
  });
  if (battle.requestState === 'teampreview') {
    battle.choose('p1', 'team 1');
    battle.choose('p2', 'team 1');
  }
  for (const [p1Choice, p2Choice] of turns) {
    if (p1Choice) battle.choose('p1', p1Choice);
    if (p2Choice) battle.choose('p2', p2Choice);
  }
  const lines = battle.log;
  return lines.filter((line, index) => !line.startsWith('|split|') && !lines[index - 1]?.startsWith('|split|')).join('\n');
}

const SPECS_SPREAD = { nature: 'Modest', evs: { spa: 252, spe: 252, hp: 4 } };
const BULKY = { nature: 'Calm', evs: { hp: 252, spd: 252 } };
const gholdengo = (item: string, spread = SPECS_SPREAD) =>
  set('Gholdengo', item, 'Good as Gold', ['Dazzling Gleam', 'Shadow Ball'], spread, 'Fairy');
const moltres = (item = 'Leftovers') => set('Moltres-Galar', item, 'Berserk', ['Protect', 'Nasty Plot'], BULKY);

function builtAs(species: string, item: string, ability: string, spread: { nature: string; evs: Partial<PokemonEvs> }): RevealedPokemonInfo {
  return {
    species, moves: [], ability: revealedField(ability), item: revealedField(item), teraType: unknownField(),
    evs: guessedEvs({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...spread.evs }), nature: guessedField(spread.nature),
    level: 100, gender: '',
  };
}
const teams = (p1: RevealedPokemonInfo[], p2: OpponentTeamInfo = { pokemon: [] }) => ({ p1: { pokemon: p1 }, p2 });
const attackerIn = (log: string, species: string) => inferOpponentTeam(log, 'p2').pokemon.find(mon => mon.species === species)!;
const CANDIDATES = ['Metal Coat', 'Choice Specs', 'Leftovers', 'Choice Scarf'];

describe('the hits the inference records', () => {
  test('singles: a Tera hit keeps its Tera, its damage and both parties', () => {
    const log = play([moltres()], [gholdengo('Choice Specs')], [['move protect', 'move dazzlinggleam terastallize'], ['move nastyplot', 'move dazzlinggleam']]);
    const hits = attackerIn(log, 'Gholdengo').hits ?? [];
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]).toMatchObject({ move: 'dazzlinggleam', doubles: false, spread: false, attacker: { species: 'Gholdengo', tera: 'Fairy' }, defender: { species: 'Moltres-Galar', side: 'p1' } });
    expect(hits[0].observed).toBeGreaterThan(0.5);
  });

  test('doubles: a spread hit carries the spread mark, one per target', () => {
    const log = play([moltres(), set('Blissey', 'Leftovers', 'Natural Cure', ['Soft-Boiled'], BULKY)],
      [gholdengo('Choice Specs'), set('Chansey', 'Eviolite', 'Natural Cure', ['Soft-Boiled'], BULKY)],
      [['move protect, move softboiled', 'move dazzlinggleam terastallize, move softboiled'], ['move nastyplot, move softboiled', 'move dazzlinggleam, move softboiled']], true);
    expect(log).toMatch(/Dazzling Gleam\|[^\n]*\[spread\]/);
    const hits = (attackerIn(log, 'Gholdengo').hits ?? []).filter(hit => hit.spread);
    expect(new Set(hits.map(hit => hit.defender.species))).toEqual(new Set(['Moltres-Galar', 'Blissey']));
  });

  test('doubles: a spread move whose other target protected still hits with the spread factor', () => {
    // The simulator decides the factor before Protect: the [spread] tag names one target; the damage is reduced.
    const log = play([moltres(), set('Blissey', 'Leftovers', 'Natural Cure', ['Soft-Boiled'], BULKY)],
      [gholdengo('Choice Specs'), set('Chansey', 'Eviolite', 'Natural Cure', ['Soft-Boiled'], BULKY)],
      [['move protect, move softboiled', 'move dazzlinggleam terastallize, move softboiled']], true);
    expect(log).toMatch(/\|move\|p2a: Gholdengo\|Dazzling Gleam\|[^\n]*\|\[spread\] p1b\n/);
    const hit = (attackerIn(log, 'Gholdengo').hits ?? []).find(entry => entry.defender.species === 'Blissey')!;
    expect(hit.spread).toBe(true);
    const gen = Generations.get(9);
    const range = (overrides?: { target: 'normal' }) => {
      const attacker = new Pokemon(gen, 'Gholdengo', { item: 'Choice Specs', nature: 'Modest', evs: { spa: 252, spe: 252, hp: 4 }, teraType: 'Fairy' });
      const defender = new Pokemon(gen, 'Blissey', { item: 'Leftovers', ability: 'Natural Cure', nature: 'Calm', evs: { hp: 252, spd: 252 } });
      const result = calculate(gen, attacker, defender, new Move(gen, 'Dazzling Gleam', overrides ? { overrides } : {}), new Field({ gameType: 'Doubles' }));
      const [low, high] = result.range();
      return [low / defender.maxHP(), high / defender.maxHP()];
    };
    const [spreadLow, spreadHigh] = range();
    const [loneLow] = range({ target: 'normal' });
    expect(spreadHigh).toBeLessThan(loneLow);
    expect(hit.observed).toBeGreaterThanOrEqual(spreadLow - 0.01);
    expect(hit.observed).toBeLessThanOrEqual(spreadHigh + 0.01);
  });

  test('a crit, a second hit on the same target and [from] damage are no clean hits', () => {
    const base = ['|gametype|singles', '|gen|9', '|tier|[Gen 9] OU', '|poke|p1|Blissey|', '|poke|p2|Garchomp|', '|start',
      '|switch|p1a: Blissey|Blissey|100/100', '|switch|p2a: Garchomp|Garchomp|100/100', '|turn|1'];
    const crit = [...base, '|move|p2a: Garchomp|Earthquake|p1a: Blissey', '|-crit|p1a: Blissey', '|-damage|p1a: Blissey|50/100', '|turn|2'];
    const twice = [...base, '|move|p2a: Garchomp|Scale Shot|p1a: Blissey', '|-damage|p1a: Blissey|90/100', '|-damage|p1a: Blissey|80/100', '|turn|2'];
    const from = [...base, '|move|p2a: Garchomp|Earthquake|p1a: Blissey', '|-damage|p1a: Blissey|90/100|[from] item: Rocky Helmet', '|turn|2'];
    for (const log of [crit, twice, from]) expect(attackerIn(log.join('\n'), 'Garchomp').hits ?? []).toEqual([]);
  });
});

describe('a candidate falls when no legal spread explains the hit', () => {
  test('singles: the hit outruns every spread without a boost, so Metal Coat, Leftovers and Choice Scarf fall and Choice Specs stays', () => {
    const log = play([moltres()], [gholdengo('Choice Specs')], [['move protect', 'move dazzlinggleam terastallize'], ['move nastyplot', 'move dazzlinggleam']]);
    const refuted = judgeItemsByDamage(attackerIn(log, 'Gholdengo'), CANDIDATES, teams([builtAs('Moltres-Galar', 'Leftovers', 'Berserk', BULKY)]));
    expect(refuted.sort()).toEqual(['choicescarf', 'leftovers', 'metalcoat']);
  });

  test('doubles: the spread factor from the log is applied, and the same items fall', () => {
    const log = play([moltres(), set('Blissey', 'Leftovers', 'Natural Cure', ['Soft-Boiled'], BULKY)],
      [gholdengo('Choice Specs'), set('Chansey', 'Eviolite', 'Natural Cure', ['Soft-Boiled'], BULKY)],
      [['move protect, move softboiled', 'move dazzlinggleam terastallize, move softboiled'], ['move nastyplot, move softboiled', 'move dazzlinggleam, move softboiled']], true);
    const built = teams([builtAs('Moltres-Galar', 'Leftovers', 'Berserk', BULKY), builtAs('Blissey', 'Leftovers', 'Natural Cure', BULKY)]);
    const refuted = judgeItemsByDamage(attackerIn(log, 'Gholdengo'), CANDIDATES, built);
    expect(refuted.sort()).toEqual(['choicescarf', 'leftovers', 'metalcoat']);
  });

  test('doubles: a spread move into a lone target hits without the spread factor', () => {
    const pichu = set('Pichu', '', 'Static', ['Thunder Shock'], { nature: 'Hardy', evs: {} });
    const log = play([moltres(), pichu], [gholdengo('Choice Specs'), set('Chansey', 'Eviolite', 'Natural Cure', ['Soft-Boiled'], BULKY)],
      [['move protect, move thundershock 1', 'move dazzlinggleam terastallize, move softboiled'], ['move nastyplot', 'move dazzlinggleam, move softboiled']], true);
    expect(log).toMatch(/\|faint\|p1b: Pichu/);
    const hits = (attackerIn(log, 'Gholdengo').hits ?? []).filter(hit => hit.defender.species === 'Moltres-Galar');
    expect(hits.length).toBe(1);
    expect(hits[0]).toMatchObject({ doubles: true, spread: false });
    const refuted = judgeItemsByDamage(attackerIn(log, 'Gholdengo'), CANDIDATES, teams([builtAs('Moltres-Galar', 'Leftovers', 'Berserk', BULKY)]));
    expect(refuted).not.toContain('choicespecs');
    expect(refuted).toContain('metalcoat');
  });

  test('singles: a hit too weak for Choice Specs on every spread rules Specs out', () => {
    const weak = { nature: 'Adamant', evs: {} };
    const log = play([moltres()], [{ ...gholdengo('Leftovers', weak), ivs: { hp: 31, atk: 31, def: 31, spa: 0, spd: 31, spe: 31 } }],
      [['move protect', 'move dazzlinggleam terastallize'], ['move nastyplot', 'move dazzlinggleam']]);
    const refuted = judgeItemsByDamage(attackerIn(log, 'Gholdengo'), CANDIDATES, teams([builtAs('Moltres-Galar', 'Leftovers', 'Berserk', BULKY)]));
    expect(refuted).toContain('choicespecs');
    expect(refuted).not.toContain('leftovers');
  });
});

describe('the calculator sees the states the log shows', () => {
  test('singles: Supreme Overlord counts the fallen allies, so a Leftovers Kingambit keeps its Leftovers', () => {
    const pichu = (name: string) => ({ ...set('Pichu', '', 'Static', ['Thunder Shock'], { nature: 'Hardy', evs: {} }), name });
    const kingambit = set('Kingambit', 'Leftovers', 'Supreme Overlord', ['Kowtow Cleave'], { nature: 'Adamant', evs: { atk: 252, hp: 252 } });
    const p1 = [set('Corviknight', 'Leftovers', 'Pressure', ['Body Press', 'Roost'], { nature: 'Impish', evs: { hp: 252, def: 4 } })];
    const fall = (next: number): [string, string][] => [['move bodypress', 'move thundershock'], ['', `switch ${next}`]];
    const log = play(p1, [pichu('Pichu A'), pichu('Pichu B'), pichu('Pichu C'), pichu('Pichu D'), kingambit],
      [...fall(2), ...fall(3), ...fall(4), ...fall(5), ['move roost', 'move kowtowcleave']]);
    const hit = (attackerIn(log, 'Kingambit').hits ?? [])[0];
    expect(hit?.attacker.alliesFainted).toBe(4);
    const built = teams([builtAs('Corviknight', 'Leftovers', 'Pressure', { nature: 'Impish', evs: { hp: 252, def: 4 } })]);
    expect(judgeItemsByDamage(attackerIn(log, 'Kingambit'), ['Leftovers', 'Choice Band', 'Black Glasses'], built)).not.toContain('leftovers');
  });

  test('a miss within the smallest item factor (x1.1) decides nothing; a wider one does', () => {
    const attacker = attackerIn(play([moltres()], [gholdengo('Choice Specs')], [['move protect', 'move dazzlinggleam terastallize'], ['move nastyplot', 'move dazzlinggleam']]), 'Gholdengo');
    const hit = (attacker.hits ?? [])[0];
    const gen = Generations.get(9);
    const target = new Pokemon(gen, 'Moltres-Galar', { item: 'Leftovers', ability: 'Berserk', nature: 'Calm', evs: { hp: 252, spd: 252 } });
    const bare = calculate(gen, new Pokemon(gen, 'Gholdengo', { ability: 'Good as Gold', nature: 'Modest', evs: { spa: 252 }, teraType: 'Fairy' }),
      target, new Move(gen, 'Dazzling Gleam'), new Field({ gameType: 'Singles' }));
    const max = bare.range()[1] / target.maxHP();
    const built = teams([builtAs('Moltres-Galar', 'Leftovers', 'Berserk', BULKY)]);
    const at = (factor: number) => ({ ...attacker, hits: [{ ...hit, observed: max * factor + 0.02, lowerBound: false }] });
    expect(judgeItemsByDamage(at(1.05), ['Choice Specs', 'Leftovers'], built)).toEqual([]);
    expect(judgeItemsByDamage(at(1.2), ['Choice Specs', 'Leftovers'], built)).toEqual(['leftovers']);
  });

  test('hits that refute every candidate and no item between them decide nothing', () => {
    const attacker = attackerIn(play([moltres()], [gholdengo('Choice Specs')], [['move protect', 'move dazzlinggleam terastallize'], ['move nastyplot', 'move dazzlinggleam']]), 'Gholdengo');
    const strong = (attacker.hits ?? [])[0];
    const weak = { ...strong, observed: 0.36 };
    const built = teams([builtAs('Moltres-Galar', 'Leftovers', 'Berserk', BULKY)]);
    expect(judgeItemsByDamage({ ...attacker, hits: [strong] }, ['Choice Specs', 'Leftovers'], built)).toEqual(['leftovers']);
    expect(judgeItemsByDamage({ ...attacker, hits: [weak] }, ['Choice Specs', 'Leftovers'], built)).toEqual(['choicespecs']);
    expect(judgeItemsByDamage({ ...attacker, hits: [strong, weak] }, ['Choice Specs', 'Leftovers'], built)).toEqual([]);
  });
});

describe('any doubt drops the hit', () => {
  const specsLog = () => play([moltres()], [gholdengo('Choice Specs')], [['move protect', 'move dazzlinggleam terastallize'], ['move nastyplot', 'move dazzlinggleam']]);
  const built = () => teams([builtAs('Moltres-Galar', 'Leftovers', 'Berserk', BULKY)]);

  test('a hit nothing explains judges nothing', () => {
    const attacker = attackerIn(specsLog(), 'Gholdengo');
    const tripled = { ...attacker, hits: (attacker.hits ?? []).map(hit => ({ ...hit, observed: hit.observed * 3, lowerBound: false })) };
    expect(judgeItemsByDamage(tripled, CANDIDATES, built())).toEqual([]);
  });

  test('a hit under a doubt, in a Champions game or in a free-ability format judges nothing', () => {
    const attacker = attackerIn(specsLog(), 'Gholdengo');
    const changed = (patch: Partial<LoggedHit>) => ({ ...attacker, hits: (attacker.hits ?? []).map(hit => ({ ...hit, ...patch })) });
    expect(judgeItemsByDamage(changed({ doubt: 'magic room' }), CANDIDATES, built())).toEqual([]);
    expect(judgeItemsByDamage(changed({ format: '[Gen 9] Champions OU' }), CANDIDATES, built())).toEqual([]);
    expect(judgeItemsByDamage(changed({ format: '[Gen 9] Balanced Hackmons' }), CANDIDATES, built())).toEqual([]);
  });

  test('doubles: a partner that may hold Friend Guard keeps the hit out', () => {
    const log = play([moltres(), set('Clefairy', 'Eviolite', 'Friend Guard', ['Protect'], BULKY)],
      [gholdengo('Choice Specs'), set('Chansey', 'Eviolite', 'Natural Cure', ['Soft-Boiled'], BULKY)],
      [['move nastyplot, move protect', 'move dazzlinggleam terastallize, move softboiled']], true);
    expect(attackerIn(log, 'Gholdengo').hits?.map(hit => hit.defender.species)).toEqual(['Moltres-Galar']);
    const built2 = teams([builtAs('Moltres-Galar', 'Leftovers', 'Berserk', BULKY), builtAs('Clefairy', 'Eviolite', 'Friend Guard', BULKY)]);
    expect(judgeItemsByDamage(attackerIn(log, 'Gholdengo'), CANDIDATES, built2)).toEqual([]);
  });

  test('a hit after the holder lost its item judges nothing about its set item', () => {
    const attacker = attackerIn(specsLog(), 'Gholdengo');
    const lost = { ...attacker, hits: (attacker.hits ?? []).map(hit => ({ ...hit, attacker: { ...hit.attacker, itemChanged: true } })) };
    expect(judgeItemsByDamage(lost, CANDIDATES, built())).toEqual([]);
  });
});

describe('the defender\'s unproven item and ability widen the hull', () => {
  const plainLog = () => play([moltres()], [gholdengo('Metal Coat')], [['move protect', 'move dazzlinggleam terastallize'], ['move nastyplot', 'move dazzlinggleam']]);
  const guessedVest = () => ({ ...builtAs('Moltres-Galar', 'Leftovers', 'Berserk', BULKY), item: guessedField('Assault Vest') });

  test('singles: a guessed Assault Vest the defender did not hold refutes nothing', () => {
    expect(judgeItemsByDamage(attackerIn(plainLog(), 'Gholdengo'), CANDIDATES, teams([guessedVest()]))).toEqual([]);
  });

  test('doubles: the same for a spread hit', () => {
    const log = play([moltres(), set('Blissey', 'Leftovers', 'Natural Cure', ['Soft-Boiled'], BULKY)],
      [gholdengo('Metal Coat'), set('Chansey', 'Eviolite', 'Natural Cure', ['Soft-Boiled'], BULKY)],
      [['move protect, move softboiled', 'move dazzlinggleam terastallize, move softboiled'], ['move nastyplot, move softboiled', 'move dazzlinggleam, move softboiled']], true);
    const built = teams([guessedVest(), builtAs('Blissey', 'Leftovers', 'Natural Cure', BULKY)]);
    expect(judgeItemsByDamage(attackerIn(log, 'Gholdengo'), CANDIDATES, built)).toEqual([]);
  });

  test('an Assault Vest the log showed still decides: Choice Specs stays, the items without a boost fall', () => {
    const vest = set('Moltres-Galar', 'Assault Vest', 'Berserk', ['Fiery Wrath'], BULKY);
    const log = play([vest], [gholdengo('Choice Specs')], [['move fierywrath', 'move dazzlinggleam terastallize']]);
    const refuted = judgeItemsByDamage(attackerIn(log, 'Gholdengo'), CANDIDATES, teams([builtAs('Moltres-Galar', 'Assault Vest', 'Berserk', BULKY)]));
    expect(refuted.sort()).toEqual(['choicescarf', 'leftovers', 'metalcoat']);
  });

  const SPECIAL = { nature: 'Modest', evs: { spa: 252, hp: 252 } };
  const blissey = (item: string) => set('Blissey', item, 'Natural Cure', ['Flash Cannon', 'Soft-Boiled'], SPECIAL);
  const rhyperior = (ability: string) => set('Rhyperior', 'Leftovers', ability, ['Iron Defense', 'Protect'], BULKY);
  const PLAIN = ['Leftovers', 'Choice Specs', 'Choice Scarf'];

  test('singles: a guessed Solid Rock the defender did not have refutes nothing; a shown one decides', () => {
    const plain = play([rhyperior('Lightning Rod')], [blissey('Leftovers')], [['move irondefense', 'move flashcannon']]);
    const guessed = { ...builtAs('Rhyperior', 'Leftovers', 'Lightning Rod', BULKY), ability: guessedField('Solid Rock') };
    expect(judgeItemsByDamage(attackerIn(plain, 'Blissey'), PLAIN, teams([guessed]))).toEqual([]);
    const boosted = play([rhyperior('Solid Rock')], [blissey('Choice Specs')], [['move irondefense', 'move flashcannon']]);
    const refuted = judgeItemsByDamage(attackerIn(boosted, 'Blissey'), PLAIN, teams([builtAs('Rhyperior', 'Leftovers', 'Solid Rock', BULKY)]));
    expect(refuted.sort()).toEqual(['choicescarf', 'leftovers']);
  });
});

describe('item-damage-champions', () => {
  Dex.formats.extend(championsMod.Formats);

  type Kind = 'singles' | 'doubles';
  const FORMAT: Record<Kind, string> = { singles: 'gen9championsou', doubles: 'gen9championsdoublescustomgame' };
  const sp = (spread: Partial<PokemonEvs>): PokemonEvs => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...spread });
  const ALL_31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
  const set = (species: string, item: string, ability: string, moves: string[], nature: string, spread: Partial<PokemonEvs>): PokemonSet => ({
    name: species, species, item, ability, moves, nature, evs: sp(spread), ivs: { ...ALL_31 }, level: 50, gender: '',
  });

  const WYRDEER_SPREAD = sp({ hp: 2, atk: 32, spe: 32 });
  const GARCHOMP_SPREAD = sp({ hp: 32, def: 32, spe: 2 });
  const wyrdeer = (item: string) => set('Wyrdeer', item, 'Sap Sipper', ['Psyshield Bash'], 'Adamant', WYRDEER_SPREAD);
  const garchomp = () => set('Garchomp', 'Leftovers', 'Sand Veil', ['Swords Dance'], 'Impish', GARCHOMP_SPREAD);
  const blissey = () => set('Blissey', 'Leftovers', 'Natural Cure', ['Protect'], 'Calm', { hp: 32, spd: 32 });

  function turnLog(kind: Kind, item: string, seed: number): string | null {
    const doubles = kind === 'doubles';
    const battle = new Battle({
      formatid: toID(FORMAT[kind]), seed: [1, 2, 3, seed],
      p1: { name: 'Alpha', team: Teams.pack(doubles ? [garchomp(), blissey()] : [garchomp()]) },
      p2: { name: 'Beta', team: Teams.pack(doubles ? [wyrdeer(item), blissey()] : [wyrdeer(item)]) },
    });
    if (battle.requestState === 'teampreview') {
      battle.choose('p1', 'default');
      battle.choose('p2', 'default');
    }
    battle.choose('p1', doubles ? 'move swordsdance, move protect' : 'move swordsdance');
    battle.choose('p2', doubles ? 'move psyshieldbash 1, move protect' : 'move psyshieldbash');
    const lines = battle.log;
    const log = lines.filter((line, index) => !line.startsWith('|split|') && !lines[index - 1]?.startsWith('|split|')).join('\n');
    return /\|-crit\|/.test(log) || !/\|move\|p2a: Wyrdeer\|Psyshield Bash/.test(log) ? null : log;
  }

  function sceneOf(kind: Kind, item: string): { log: string; attacker: RevealedPokemonInfo } {
    let best: { log: string; attacker: RevealedPokemonInfo } | null = null;
    for (let seed = 1; seed <= 120; seed++) {
      const log = turnLog(kind, item, seed);
      if (!log) continue;
      const attacker = inferOpponentTeam(log, 'p2').pokemon.find(mon => mon.species === 'Wyrdeer');
      if (attacker?.hits?.length && (!best || attacker.hits[0].observed > best.attacker.hits![0].observed)) best = { log, attacker };
    }
    if (!best) throw new Error('no clean Psyshield Bash in 120 seeds');
    return best;
  }

  const garchompInfo = (): RevealedPokemonInfo => ({
    species: 'Garchomp', moves: [], ability: revealedField('Sand Veil'), item: revealedField('Leftovers'), teraType: unknownField(),
    evs: guessedEvs(GARCHOMP_SPREAD), nature: guessedField('Impish'), level: 50, gender: '',
  });
  const teamsOf = () => ({ p1: { pokemon: [garchompInfo()] }, p2: { pokemon: [] as RevealedPokemonInfo[] } });
  const CANDIDATES = ['Life Orb', 'Leftovers', 'Sitrus Berry', 'Focus Sash'];
  const hitOf = (attacker: RevealedPokemonInfo): LoggedHit => attacker.hits![0];

  describe('the damage judge on a Champions game', () => {
    for (const kind of ['singles', 'doubles'] as const) {
      test(`${kind}: the log of a Champions game names its format and its hit`, () => {
        const { attacker } = sceneOf(kind, '');
        expect(hitOf(attacker)).toMatchObject({ move: 'psyshieldbash', gen: 9, doubles: kind === 'doubles', attacker: { species: 'Wyrdeer' }, defender: { species: 'Garchomp', side: 'p1' } });
        expect(hitOf(attacker).format).toMatch(/champions/i);
        expect(calcGenerationFor(hitOf(attacker).gen, calcModOf(hitOf(attacker).format)).num).toBe(0);
      });

      test(`${kind}: Wyrdeer without a boost item hits at the mod's power 90 and the judge rules out no item`, () => {
        const { attacker } = sceneOf(kind, '');
        const hit = hitOf(attacker);
        const gen = calcGenerationFor(9, 'champions');
        const basePower = Dex.forGen(9).moves.get('psyshieldbash').basePower;
        const modPower = Dex.dexes.champions.moves.get('psyshieldbash').basePower;
        expect(modPower).toBeGreaterThan(basePower);
        const body = (species: string, options: ConstructorParameters<typeof Pokemon>[2]) => new Pokemon(gen, species, { level: 50, ...options });
        const defender = body('Garchomp', { nature: 'Impish', ability: 'Sand Veil', item: 'Leftovers', evs: GARCHOMP_SPREAD });
        const strong = body('Wyrdeer', { nature: 'Adamant', ability: 'Sap Sipper', evs: { atk: 32 } });
        const reread = calculate(gen, strong, defender, new Move(gen, 'Psyshield Bash', { overrides: { basePower } }), new Field()).damage as number[];
        expect(hit.observed - 0.02).toBeGreaterThan(Math.max(...reread) / defender.maxHP());
        expect(judgeItemsByDamage(attacker, CANDIDATES, teamsOf())).toEqual([]);
      });

      test(`${kind}: a hit only Life Orb explains rules out Leftovers, Sitrus Berry and Focus Sash`, () => {
        const { attacker } = sceneOf(kind, 'Life Orb');
        expect(judgeItemsByDamage(attacker, CANDIDATES, teamsOf()).sort()).toEqual(['focussash', 'leftovers', 'sitrusberry']);
      });

      test(`${kind}: a Choice Band hit, which the Champions mod marks Past, is explained by no item that exists there`, () => {
        // The simulator still plays Choice Band, but the calculator's generation 0 lists neither Band nor Specs.
        const { attacker } = sceneOf(kind, 'Choice Band');
        expect(judgeItemsByDamage(attacker, CANDIDATES, teamsOf())).toEqual([]);
      });
    }
  });

  describe('the spread solver reads the same Champions hit on Stat Points', () => {
    const SOLVER_FORMAT: Record<Kind, string> = { singles: 'gen9championsou', doubles: 'gen9championsvgc2026regmcbo3' };
    for (const kind of ['singles', 'doubles'] as const) {
      test(`${kind}: the spread the simulator played fits the hit at the mod's power, a weaker one does not`, () => {
        const { attacker } = sceneOf(kind, '');
        const hit = hitOf(attacker);
        const observation: DamageObservation = {
          attackerSpecies: 'Wyrdeer', defenderSpecies: 'Garchomp', attackerSide: 'p2', moveId: 'psyshieldbash', observedFraction: hit.observed,
          lethal: false, attackerBoosts: {}, defenderBoosts: hit.defender.boosts, attackerStatus: '', screens: [], weather: '',
        };
        const sets = { p1: [garchomp()], p2: [wyrdeer('')] };
        const ctx = buildSolveContext([observation], sets, SOLVER_FORMAT[kind], []);
        expect(observationError(ctx, observation, 'p2:wyrdeer', { evs: WYRDEER_SPREAD, nature: 'Adamant' })).toBe(0);
        expect(observationError(ctx, observation, 'p2:wyrdeer', { evs: sp({ spe: 32 }), nature: 'Hardy' })).toBeGreaterThan(0);
      });
    }
  });
});

const slot = (value: string, options?: string[]): SetAssumption => ({ value, sourceDetail: 's', ...(options ? { options } : {}) });
const evs = (hp: number, atk: number, def: number, spa: number, spd: number, spe: number) => ({ hp, atk, def, spa, spd, spe });
const publishedSet = (species: string, item: SetAssumption, moves: SetAssumption[], nature: string, spread: ReturnType<typeof evs>): PokemonSetAssumption => ({
  species, sourceDetail: 's', item, moves, spread: { value: '', sourceDetail: 's', nature, evs: spread },
});
const usage = (species: string, items: [string, number][], moves: [string, number][], spreads: [string, ReturnType<typeof evs>, number][] = []): PokemonUsageStats => ({
  species, rawCount: 1000, abilities: [],
  items: items.map(([value, probability]) => ({ value, probability, sourceDetail: 'u' })),
  moves: moves.map(([value, probability]) => ({ value, probability, sourceDetail: 'u' })),
  spreads: spreads.map(([nature, value, probability]) => ({ value: nature, nature, evs: value, probability, sourceDetail: 'u' })),
});

const gholdengoSets = (): PokemonSetAssumption => ({
  ...publishedSet('Gholdengo', slot('Leftovers', ['Leftovers', 'Metal Coat']),
    [slot('Protect'), slot('Nasty Plot'), slot('Make It Rain'), slot('Shadow Ball', ['Shadow Ball', 'Dazzling Gleam'])], 'Modest', evs(248, 0, 40, 112, 24, 84)),
  alternatives: [
    publishedSet('Gholdengo', slot('Choice Specs'), [slot('Make It Rain'), slot('Shadow Ball'), slot('Power Gem', ['Power Gem', 'Focus Blast']), slot('Trick')], 'Modest', evs(100, 0, 44, 252, 0, 112)),
    publishedSet('Gholdengo', slot('Choice Scarf'), [slot('Make It Rain'), slot('Shadow Ball'), slot('Thunderbolt'), slot('Trick')], 'Timid', evs(0, 0, 0, 252, 4, 252)),
  ],
});
const moltresSet = () => publishedSet('Moltres-Galar', slot('Leftovers'),
  [slot('Fiery Wrath'), slot('Nasty Plot'), slot('Air Slash'), slot('Protect')], 'Modest', evs(252, 0, 0, 192, 0, 64));
const incineroarSet = () => publishedSet('Incineroar', slot('Sitrus Berry'),
  [slot('Fake Out'), slot('Knock Off'), slot('Parting Shot'), slot('Flare Blitz')], 'Careful', evs(252, 4, 0, 0, 252, 0));

const sets: SmogonSetAssumptions = {
  format: 'gen9doublesou', source: 's',
  pokemon: { gholdengo: gholdengoSets(), moltresgalar: moltresSet(), incineroar: incineroarSet() },
};
const usageStats: SmogonUsageStats = {
  format: 'gen9doublesou', month: 'm', source: 's', pokemon: Object.fromEntries([
    usage('Gholdengo',
      [['Choice Specs', 0.252], ['Leftovers', 0.189], ['Grassy Seed', 0.188], ['Choice Scarf', 0.106], ['Life Orb', 0.088], ['Shuca Berry', 0.042],
        ['Focus Sash', 0.038], ['Metal Coat', 0.035], ['Air Balloon', 0.019]],
      [['Make It Rain', 0.99], ['Shadow Ball', 0.9], ['Protect', 0.6], ['Nasty Plot', 0.55], ['Dazzling Gleam', 0.3], ['Trick', 0.27], ['Power Gem', 0.1]],
      [['Timid', evs(4, 0, 0, 252, 0, 252), 0.133]]),
  ].map(entry => [toId(entry.species), entry])),
};

const scene = [
  '|player|p1|Alpha|', '|player|p2|Beta|', '|gametype|doubles', '|gen|9', '|tier|[Gen 9] Doubles OU',
  '|poke|p1|Incineroar, M|', '|poke|p1|Moltres-Galar|', '|poke|p1|Ursaluna, F|', '|poke|p1|Sinistcha|',
  '|poke|p2|Ursaluna, M|', '|poke|p2|Gholdengo|', '|poke|p2|Sinistcha|', '|poke|p2|Moltres-Galar|',
  '|teamsize|p1|4', '|teamsize|p2|4', '|start',
  '|switch|p1a: Ignis Flame|Incineroar, M|30/100', '|switch|p1b: Black Sun|Moltres-Galar|84/100',
  '|switch|p2a: Fearless|Ursaluna, M|100/100', '|switch|p2b: Cooldown|Gholdengo, tera:Fairy|22/100',
  '|turn|1',
  '|move|p1a: Ignis Flame|Fake Out|p2a: Fearless', '|-damage|p2a: Fearless|91/100',
  '|move|p1b: Black Sun|Nasty Plot|p1b: Black Sun', '|-boost|p1b: Black Sun|spa|2',
  '|', '|-heal|p1b: Black Sun|90/100|[from] item: Leftovers', '|upkeep',
  '|turn|2',
  '|move|p2b: Cooldown|Dazzling Gleam|p1a: Ignis Flame|[spread] p1a,p1b', '|-supereffective|p1b: Black Sun',
  '|-damage|p1a: Ignis Flame|0 fnt', '|-damage|p1b: Black Sun|24/100', '|faint|p1a: Ignis Flame',
  '|-ability|p1b: Black Sun|Berserk|boost', '|-boost|p1b: Black Sun|spa|1',
  '|', '|upkeep', '|turn|3',
].join('\n');

function chain(log: string, data: { usageStats: SmogonUsageStats; setAssumptions: SmogonSetAssumptions }, species: string) {
  const raw = { p1: inferOpponentTeam(log, 'p1'), p2: inferOpponentTeam(log, 'p2') };
  const infos = enrichTeamInfos(raw, data.usageStats, data.setAssumptions, {}, judgeItemsByDamage);
  const team = buildTeamsFromReplay(log, { p1Info: infos.p1, p2Info: infos.p2, ...data }).p2Team;
  const mon = infos.p2.pokemon.find(entry => entry.species === species)!;
  return { panel: mon.item.value, built: team.find(entry => entry.species === species)!.item, ruledOut: mon.ruledOut?.items ?? [] };
}

describe('938644 t14: the logged hit rules Metal Coat out for panel and build', () => {
  test('doubles: today\'s per-side enrichment plays the Nasty Plot set\'s Metal Coat', () => {
    const p2Info = enrichTeamInfo(inferOpponentTeam(scene, 'p2'), usageStats, sets);
    expect(p2Info.pokemon.find(entry => entry.species === 'Gholdengo')!.item.value).toBe('Metal Coat');
  });

  test('doubles: the joint enrichment rules Metal Coat out, and panel and build play the usage majority Choice Specs', () => {
    const { panel, built, ruledOut } = chain(scene, { usageStats, setAssumptions: sets }, 'Gholdengo');
    expect(ruledOut).toContain('metalcoat');
    expect({ panel, built }).toEqual({ panel: 'Choice Specs', built: 'Choice Specs' });
  });

  test('without a judge the joint enrichment is the per-side enrichment', () => {
    const raw = { p1: inferOpponentTeam(scene, 'p1'), p2: inferOpponentTeam(scene, 'p2') };
    expect(enrichTeamInfos(raw, usageStats, sets, {})).toEqual({
      p1: enrichTeamInfo(raw.p1, usageStats, sets), p2: enrichTeamInfo(raw.p2, usageStats, sets),
    });
  });
});

describe('singles: the same decision from a simulated game', () => {
  const BULKY = { nature: 'Calm', evs: { hp: 252, spd: 252 } };
  const mon = (species: string, item: string, ability: string, moves: string[], spread: { nature: string; evs: object }, teraType?: string): PokemonSet => ({
    name: species, species, item, ability, moves, nature: spread.nature, level: 100, gender: '', teraType,
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...spread.evs }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  } as PokemonSet);

  test('a Choice Specs Gholdengo that showed only Dazzling Gleam plays Choice Specs, not the slot\'s Metal Coat', () => {
    const battle = new Battle({
      formatid: toID('gen9ou'), seed: '1,2,3,4',
      p1: { name: 'Alpha', team: Teams.pack([mon('Moltres-Galar', 'Leftovers', 'Berserk', ['Protect', 'Nasty Plot'], BULKY)]) },
      p2: { name: 'Beta', team: Teams.pack([mon('Gholdengo', 'Choice Specs', 'Good as Gold', ['Dazzling Gleam'], { nature: 'Modest', evs: { spa: 252, spe: 252, hp: 4 } }, 'Fairy')]) },
    });
    battle.choose('p1', 'team 1');
    battle.choose('p2', 'team 1');
    battle.choose('p1', 'move nastyplot');
    battle.choose('p2', 'move dazzlinggleam terastallize');
    const lines = battle.log;
    const log = lines.filter((line, index) => !line.startsWith('|split|') && !lines[index - 1]?.startsWith('|split|')).join('\n');
    const singlesSets: SmogonSetAssumptions = {
      format: 'gen9ou', source: 's', pokemon: {
        gholdengo: gholdengoSets(),
        moltresgalar: publishedSet('Moltres-Galar', slot('Leftovers'), [slot('Nasty Plot'), slot('Protect'), slot('Fiery Wrath'), slot('Hurricane')], 'Calm', evs(252, 0, 0, 0, 252, 4)),
      },
    };
    const { panel, built, ruledOut } = chain(log, { usageStats, setAssumptions: singlesSets }, 'Gholdengo');
    expect(ruledOut).toContain('metalcoat');
    expect({ panel, built }).toEqual({ panel: 'Choice Specs', built: 'Choice Specs' });
  });
});
