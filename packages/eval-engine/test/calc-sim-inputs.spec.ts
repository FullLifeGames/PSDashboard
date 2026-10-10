import { describe, expect, test } from 'vitest';
import { Field, Generations, Move, Pokemon, calculate } from '@smogon/calc';
import type { Battle } from '@pkmn/sim';
import { makePokemonInfo } from '../src/branch/pokemon-info';
import { positionBattle } from '../src/forward-model';
import { boundaryEvent } from '../src/ko-odds';
import { killCount } from '../src/pair/kill-table';
import { checkedRolls, drawTurn, rollSet as set, rootOf } from './calc-roll-oracle';

/**
 * Round 67, lane A (T76): the calc gets what the simulator holds and calc 0.11
 * cannot see otherwise. Protosynthesis and Quark Drive boost the stat their
 * volatile names (bestStat), Supreme Overlord counts the fallen its ability
 * state keeps (abilityState.fallen), Last Respects powers up by the side's
 * fallen (side.totalFainted). Nothing is derived from weather, terrain or item.
 */

/** Kingambit comes in after three of its side fell: Supreme Overlord counts them on entry. */
function overlordRoot(format: 'gen9customgame' | 'gen9doublescustomgame') {
  const doubles = format === 'gen9doublescustomgame';
  const p1 = [set('Pawmot', ['Splash']), ...(doubles ? [set('Corviknight', ['Roost', 'Protect'])] : []),
    set('Kingambit', ['Iron Head'], { ability: 'Supreme Overlord' })];
  const p2 = [set('Snorlax', ['Splash'], { ability: 'Battle Armor' }), ...(doubles ? [set('Blissey', ['Soft-Boiled'], { ability: 'Battle Armor' })] : [])];
  return rootOf(format, p1, p2, (battle: Battle) => {
    battle.sides[0].totalFainted = 3;
    battle.choose('p1', doubles ? 'switch 3, move roost' : 'switch 2');
    battle.choose('p2', doubles ? 'move splash, move softboiled' : 'move splash');
    battle.sides[1].active[0].sethp(120);
  });
}

describe('the simulator\'s inputs reach the calc (T76)', () => {
  test('singles: Supreme Overlord\'s fallen count reaches the odds and the table, as the simulator hits', () => {
    const root = overlordRoot('gen9customgame');
    const battle = positionBattle(root);
    const kingambit = battle.sides[0].active[0];
    expect(kingambit.species.name).toBe('Kingambit');
    expect((kingambit.abilityState as { fallen?: number }).fallen).toBe(3);
    const [hit] = checkedRolls(drawTurn(root, 'move ironhead', 'move splash'));
    expect(hit.holds).toBe(true);
    const event = boundaryEvent(battle, kingambit, battle.sides[1].active[0], 'ironhead')!;
    expect(event.normalKillRolls).toBe(killCount(hit.table!.normal, 120));
  });

  test('doubles: Kingambit\'s Iron Head after three faints lands on its kill table', () => {
    const root = overlordRoot('gen9doublescustomgame');
    const hits = checkedRolls(drawTurn(root, 'move ironhead 1, move roost', 'move splash, move softboiled'));
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every(({ holds }) => holds)).toBe(true);
  });

  test('singles and doubles: Booster Energy\'s Quark Drive boosts the stat its volatile names', () => {
    const bundle = () => set('Iron Bundle', ['Ice Beam'], { ability: 'Quark Drive', item: 'Booster Energy' });
    const single = rootOf('gen9customgame', [bundle()], [set('Snorlax', ['Splash'], { ability: 'Battle Armor' })]);
    const drive = (positionBattle(single).sides[0].active[0].volatiles as Record<string, { bestStat?: string }>).quarkdrive;
    expect(drive?.bestStat).toBe('spa');
    expect(checkedRolls(drawTurn(single, 'move icebeam', 'move splash')).every(({ holds }) => holds)).toBe(true);
    const double = rootOf('gen9doublescustomgame', [bundle(), set('Corviknight', ['Roost'])],
      [set('Snorlax', ['Splash'], { ability: 'Battle Armor' }), set('Blissey', ['Soft-Boiled'], { ability: 'Battle Armor' })]);
    const hits = checkedRolls(drawTurn(double, 'move icebeam 1, move roost', 'move splash, move softboiled'));
    expect(hits.length).toBe(1);
    expect(hits[0].holds).toBe(true);
  });

  test('doubles: Last Respects after two faints lands on its kill table (the power its own callback gives)', () => {
    const root = rootOf('gen9doublescustomgame',
      [set('Houndstone', ['Last Respects']), set('Corviknight', ['Roost'])],
      [set('Garchomp', ['Splash'], { ability: 'Battle Armor', evs: { hp: 252, atk: 0, def: 252, spa: 0, spd: 0, spe: 0 } }), set('Blissey', ['Soft-Boiled'], { ability: 'Battle Armor' })],
      battle => { battle.sides[0].totalFainted = 2; });
    const hits = checkedRolls(drawTurn(root, 'move lastrespects 1, move roost', 'move splash, move softboiled'));
    expect(hits.length).toBe(1);
    expect(hits[0].holds).toBe(true);
  });

  test('the picker\'s state carries the volatile\'s stat, the fallen count and the side\'s fallen', () => {
    const battle = positionBattle(overlordRoot('gen9customgame'));
    const kingambit = makePokemonInfo(battle.sides[0].active[0] as never, true, 0);
    expect(kingambit.alliesFainted).toBe(3);
    expect(kingambit.totalFainted).toBe(3);
    expect(kingambit.boostedStat).toBeUndefined();
    const bundle = positionBattle(rootOf('gen9customgame', [set('Iron Bundle', ['Ice Beam'], { ability: 'Quark Drive', item: 'Booster Energy' })], [set('Snorlax', ['Splash'])]));
    expect(makePokemonInfo(bundle.sides[0].active[0] as never, true, 0).boostedStat).toBe('spa');
  });

  test('checker: calc 0.11 prices Last Respects at its listed power whatever alliesFainted says, so the engine passes the power', () => {
    const gen = Generations.get(9);
    const range = (alliesFainted: number) => calculate(gen, new Pokemon(gen, 'Houndstone', { alliesFainted }), new Pokemon(gen, 'Garchomp'), new Move(gen, 'Last Respects'), new Field({})).range();
    expect(range(3)).toEqual(range(0));
  });
});
