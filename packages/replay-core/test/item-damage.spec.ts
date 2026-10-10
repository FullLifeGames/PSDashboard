import { test, expect, describe } from 'vitest';
import { Battle, Teams, toID, type PokemonSet } from '@pkmn/sim';
import { calculate, Field, Generations, Move, Pokemon } from '@smogon/calc';
import { inferOpponentTeam } from '../src/opponent-inferrer';
import { judgeItemsByDamage } from '../src/team/item-damage';
import { guessedEvs, guessedField, revealedField, unknownField } from '../src/team-info';
import type { LoggedHit, OpponentTeamInfo, PokemonEvs, RevealedPokemonInfo } from '../src/types';

/**
 * The damage judge (round 67, T130, decision 18): an item candidate falls
 * when no legal spread of its holder lets the calculator explain a hit the
 * log shows, against the defender as the panel builds it (ruling R1). Logs
 * come from @pkmn/sim, so each hit really happened with the item the game
 * gave its holder; the judge sees only the log.
 */

function set(species: string, item: string, ability: string, moves: string[], spread: { nature: string; evs: Partial<PokemonEvs> }, teraType?: string): PokemonSet {
  return {
    name: species, species, item, ability, moves, nature: spread.nature, level: 100, gender: '', teraType,
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...spread.evs },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  } as PokemonSet;
}

/** The spectators' log of a game; an empty choice skips a side. */
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

/** The defender as the panel builds it: here the spread the game really gave it. */
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

describe('the hits the inference records (T130)', () => {
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

  test('doubles: a spread move whose other target protected still hits with the spread factor (ruling R4)', () => {
    // The simulator decides the factor before Protect: the [spread] tag then names one target, and the damage is the reduced one.
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

describe('a candidate falls when no legal spread explains the hit (T130)', () => {
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
    // Turn 1 knocks out p1's Pichu (no replacement); turn 2's Dazzling Gleam finds Moltres-Galar alone.
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

describe('the calculator sees the states the log shows (T130)', () => {
  test('singles: Supreme Overlord counts the fallen allies, so a Leftovers Kingambit keeps its Leftovers', () => {
    const pichu = (name: string) => ({ ...set('Pichu', '', 'Static', ['Thunder Shock'], { nature: 'Hardy', evs: {} }), name });
    const kingambit = set('Kingambit', 'Leftovers', 'Supreme Overlord', ['Kowtow Cleave'], { nature: 'Adamant', evs: { atk: 252, hp: 252 } });
    const p1 = [set('Corviknight', 'Leftovers', 'Pressure', ['Body Press', 'Roost'], { nature: 'Impish', evs: { hp: 252, def: 4 } })];
    // Four Pichu fall to Body Press, then Kingambit hits with four allies down (power x1.4).
    const fall = (next: number): [string, string][] => [['move bodypress', 'move thundershock'], ['', `switch ${next}`]];
    const log = play(p1, [pichu('Pichu A'), pichu('Pichu B'), pichu('Pichu C'), pichu('Pichu D'), kingambit],
      [...fall(2), ...fall(3), ...fall(4), ...fall(5), ['move roost', 'move kowtowcleave']]);
    const hit = (attackerIn(log, 'Kingambit').hits ?? [])[0];
    expect(hit?.attacker.alliesFainted).toBe(4);
    const built = teams([builtAs('Corviknight', 'Leftovers', 'Pressure', { nature: 'Impish', evs: { hp: 252, def: 4 } })]);
    expect(judgeItemsByDamage(attackerIn(log, 'Kingambit'), ['Leftovers', 'Choice Band', 'Black Glasses'], built)).not.toContain('leftovers');
  });

  test('a miss within the smallest item factor (x1.1) decides nothing; a wider one does (ruling R12)', () => {
    const attacker = attackerIn(play([moltres()], [gholdengo('Choice Specs')], [['move protect', 'move dazzlinggleam terastallize'], ['move nastyplot', 'move dazzlinggleam']]), 'Gholdengo');
    const hit = (attacker.hits ?? [])[0];
    // The no-item maximum the judge reads: the holder at Modest 252 SpA against the Moltres-Galar as built.
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

describe('any doubt drops the hit (T130, ruling R3)', () => {
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
    expect(judgeItemsByDamage(changed({ format: '[Gen 9] Custom Game' }), CANDIDATES, built())).toEqual([]);
  });

  test('doubles: a partner that may hold Friend Guard keeps the hit out', () => {
    // Clefairy protects, so the only hit lands on Moltres-Galar with a possible Friend Guard beside it.
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
