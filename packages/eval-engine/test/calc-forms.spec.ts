import { describe, expect, test } from 'vitest';
import { Field, Generations, Move, Pokemon, calculate } from '@smogon/calc';
import { Dex, toID } from '@pkmn/sim';
import type { BranchMoveOption, SimPokemonInfo } from '../src/branch-engine';
import { calcSpecies } from '../src/calc/body';
import { corroborateChoiceItem } from '../src/choice-lock';
import { calcSingleDamageRange } from '../src/damage-calc';
import { positionBattle, type SimPosition } from '../src/forward-model';
import { boundaryEvent } from '../src/ko-odds';
import { killCount } from '../src/pair/kill-table';
import { checkedRolls, drawTurn, rollSet as set, rootOf } from './calc-roll-oracle';
import { doublesRoot, pairSet } from './pair-battles';

/**
 * Round 67, lane A (T72): a species the calc does not know goes to it as
 * the form it does know with the same Dex base stats and types (Gastrodon-East
 * as Gastrodon, the simulator's "Aegislash" as Aegislash-Shield, color forms);
 * an attacking Aegislash in the forme its Stance Change gives it at use.
 */
const STATS = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };

function mon(species: string, overrides: Partial<SimPokemonInfo> = {}): SimPokemonInfo {
  const evs = { ...STATS, hp: 252, atk: 252, spa: 252 };
  const known = calcSpecies(9, species);
  const maxhp = new Pokemon(Generations.get(9), known, { evs }).maxHP();
  return {
    name: species, species, hp: maxhp, maxhp, hpPercent: 100, status: '', fainted: false, isActive: true, activeSlot: 0,
    moves: [], ability: '', item: '', stats: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, nature: 'Hardy', evs,
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, gender: '', teraType: '', boosts: {}, level: 100,
    types: [], ...overrides,
  };
}

function move(name: string, targetType = 'normal'): BranchMoveOption {
  return { name, activeSlot: 0, slot: 1, pp: 16, maxpp: 16, disabled: false, type: '', targetType, requiresTarget: false, targetOptions: [] };
}

const singlesRoot = (p1: Parameters<typeof rootOf>[1], p2: Parameters<typeof rootOf>[2], setup?: Parameters<typeof rootOf>[3]) => rootOf('gen9customgame', p1, p2, setup);
const rolls = (root: SimPosition, p1: string, p2: string) => checkedRolls(drawTurn(root, p1, p2));

describe('forms the calc does not know (T72)', () => {
  test('the preview prices Gastrodon-East as Gastrodon, attacking and defending, singles and doubles', () => {
    for (const gameType of ['Singles', 'Doubles'] as const) {
      const into = calcSingleDamageRange(mon('Gastrodon-East'), mon('Snorlax'), move('Earth Power'), { gameType, gen: 9 });
      expect(into.range, gameType).not.toBe('-');
      expect(into.range, gameType).toBe(calcSingleDamageRange(mon('Gastrodon'), mon('Snorlax'), move('Earth Power'), { gameType, gen: 9 }).range);
      const from = calcSingleDamageRange(mon('Garchomp'), mon('Gastrodon-East'), move('Dragon Claw'), { gameType, gen: 9 });
      expect(from.range, gameType).not.toBe('-');
      expect(from.range, gameType).toBe(calcSingleDamageRange(mon('Garchomp'), mon('Gastrodon'), move('Dragon Claw'), { gameType, gen: 9 }).range);
    }
  });

  test('singles: the simulator\'s "Aegislash" (Shield forme) takes a hit priced as Aegislash-Shield, on the table the roll lands on', () => {
    const root = singlesRoot([set('Garchomp', ['Earthquake'])], [set('Aegislash', ['Splash'], { ability: 'Stance Change' })]);
    const battle = positionBattle(root);
    expect(battle.sides[1].active[0].species.name).toBe('Aegislash');
    expect(boundaryEvent(battle, battle.sides[0].active[0], battle.sides[1].active[0], 'earthquake')).not.toBeNull();
    const [hit] = rolls(root, 'move earthquake', 'move splash');
    expect(hit.table).not.toBeNull();
    expect(hit.holds).toBe(true);
  });

  test('singles: an attacking Aegislash is priced in the forme its Stance Change gives it at use, as the simulator hits', () => {
    const root = singlesRoot([set('Aegislash', ['Iron Head'], { ability: 'Stance Change' })], [set('Snorlax', ['Splash'], { ability: 'Battle Armor' })], battle => {
      battle.sides[1].active[0].sethp(70);
    });
    const battle = positionBattle(root);
    const event = boundaryEvent(battle, battle.sides[0].active[0], battle.sides[1].active[0], 'ironhead');
    expect(event).not.toBeNull();
    const [hit] = rolls(root, 'move ironhead', 'move splash');
    expect(hit.roll.snapshot.attacker.species).toBe('Aegislash-Blade');
    expect(event!.normalKillRolls).toBe(killCount(hit.table!.normal, 70));
  });

  test('doubles: a hit into Gastrodon-East lands on its kill table at the drawn roll', () => {
    const root = doublesRoot(
      [pairSet('Chomp', 'Garchomp', ['Dragon Claw', 'Protect']), pairSet('Mate', 'Corviknight', ['Roost', 'Protect'])],
      [pairSet('Slug', 'Gastrodon-East', ['Splash', 'Protect'], { ability: 'Sticky Hold' }), pairSet('Wall', 'Blissey', ['Soft-Boiled', 'Protect'])],
    );
    const hits = rolls(root, 'move dragonclaw 1, move roost', 'move splash, move softboiled');
    expect(hits).toHaveLength(1);
    expect(hits[0].holds).toBe(true);
  });

  test('choice-lock judges a guessed Choice Specs on a hit into Gastrodon-East', () => {
    const teams = { p1Team: [set('Keldeo', ['Hydro Pump'], { item: 'Choice Specs' })], p2Team: [set('Gastrodon-East', ['Recover'])] };
    const calcGen = Generations.get(9);
    const band = (item: string) => {
      const result = calculate(calcGen,
        new Pokemon(calcGen, 'Keldeo', { level: 50, item: (item || undefined) as never, nature: 'Hardy', evs: teams.p1Team[0].evs }),
        new Pokemon(calcGen, 'Gastrodon', { level: 50, nature: 'Hardy', evs: teams.p2Team[0].evs }),
        new Move(calcGen, 'Hydro Pump'), new Field({}));
      const [min, max] = result.range();
      return [min / result.defender.maxHP(), max / result.defender.maxHP()];
    };
    const specs = band('Choice Specs');
    const fraction = (specs[0] + specs[1]) / 2;
    expect(fraction).toBeGreaterThan(band('')[1] + 0.02);
    expect(fraction).toBeGreaterThan(band('Mystic Water')[1] + 0.02);
    const observation = [{
      attackerSpecies: 'Keldeo', defenderSpecies: 'Gastrodon-East', attackerSide: 'p1' as const, moveId: 'hydropump',
      observedFraction: fraction, lethal: false, attackerBoosts: {}, defenderBoosts: {}, attackerStatus: '', screens: [], weather: '',
    }];
    expect(corroborateChoiceItem('p1', 'Keldeo', 'Choice Specs', teams, observation, 9)).toBe('corroborated');
  });
});

describe('the form map reads the Dex and the calc data, no list (T72)', () => {
  test('every species of gens 6 to 9 the calc refuses maps to a form of the same base species with equal base stats and types, or stays', () => {
    /** The map's promise for one name: the same base species, base stats and types, or the name itself. */
    const holds = (gen: number, name: string) => {
      const known = calcSpecies(gen, name);
      if (known === name) return known;
      const species = Dex.forGen(gen).species.get(name);
      const calcForm = Generations.get(gen as 9).species.get(toID(known))!;
      expect(Dex.forGen(gen).species.get(known).baseSpecies, `${gen} ${name}`).toBe(species.baseSpecies);
      expect(calcForm.baseStats, `${gen} ${name}`).toEqual(species.baseStats);
      expect([...calcForm.types], `${gen} ${name}`).toEqual([...species.types]);
      return known;
    };
    for (const gen of [6, 7, 8, 9]) {
      const calcGen = Generations.get(gen as 9);
      for (const species of Dex.forGen(gen).species.all()) {
        if (species.exists && !calcGen.species.get(toID(species.name))) holds(gen, species.name);
      }
    }
    // The forms the bank and the fit corpus carry (round 62 census); color forms resolve through the Dex, not its list.
    expect(holds(9, 'Gastrodon-East')).toBe('Gastrodon');
    expect(holds(9, 'Aegislash')).toBe('Aegislash-Shield');
    expect(holds(6, 'Aegislash')).toBe('Aegislash-Shield');
    expect(holds(9, 'Florges-White')).toBe('Florges');
    expect(holds(9, 'Vivillon-Garden')).toBe('Vivillon');
    expect(holds(9, 'Alcremie-Ruby-Cream')).toBe('Alcremie');
  });
});
