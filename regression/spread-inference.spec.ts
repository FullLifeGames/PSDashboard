import { test, expect } from '@playwright/test';
import { Generations, Pokemon, Move, calculate } from '@smogon/calc';
import type { PokemonSet } from '@pkmn/sim';
import { inferSpreads } from '../src/lib/spread-inference';
import type { DamageObservation } from '../src/types';

const gen = Generations.get(9);

const set = (species: string, moves: string[]): PokemonSet => ({
  name: species, species, item: '', ability: '', moves,
  nature: 'Hardy',
  evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  level: 50, gender: '',
});

/** A mid-roll hit computed forward with the TRUE spreads — the ground truth. */
function observe(moveName: string, defEvs: Partial<Record<'hp' | 'def' | 'spd', number>>, defNature: string): DamageObservation {
  const attacker = new Pokemon(gen, 'Landorus-Therian', {
    level: 50, nature: 'Hardy',
    evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
  });
  const defender = new Pokemon(gen, 'Uxie', { level: 50, nature: defNature, evs: defEvs });
  const result = calculate(gen, attacker, defender, new Move(gen, moveName));
  const rolls = (Array.isArray(result.damage) ? (result.damage as number[]).flat() : [Number(result.damage)]).map(Number);
  const mid = rolls[Math.floor(rolls.length / 2)];
  return {
    attackerSpecies: 'Landorus-Therian',
    defenderSpecies: 'Uxie',
    attackerSide: 'p2',
    moveId: moveName.toLowerCase().replace(/[^a-z0-9]/g, ''),
    observedFraction: mid / defender.maxHP(),
    attackerBoosts: {}, defenderBoosts: {}, attackerStatus: '',
    screens: [], weather: '',
  };
}

const sets = {
  p1: [set('Uxie', ['Stealth Rock', 'U-turn'])],
  p2: [set('Landorus-Therian', ['U-turn', 'Knock Off'])],
};

test.describe('damage-consistent spread inference', () => {
  test('recovers a physically bulky defender from its observed damage', () => {
    const observations = [
      observe('U-turn', { hp: 252, def: 252 }, 'Bold'),
      observe('Knock Off', { hp: 252, def: 252 }, 'Bold'),
    ];
    const inferred = inferSpreads(observations, sets, 'gen9customgame');
    const uxie = inferred.get('p1:uxie');
    expect(uxie).toBeTruthy();
    expect(uxie!.evs.hp).toBe(252);
    expect(uxie!.evs.def).toBe(252);
  });

  test('recovers an uninvested defender and skips under-observed mons', () => {
    const observations = [
      observe('U-turn', {}, 'Hardy'),
      observe('Knock Off', {}, 'Hardy'),
    ];
    const inferred = inferSpreads(observations, sets, 'gen9customgame');
    const uxie = inferred.get('p1:uxie');
    expect(uxie).toBeTruthy();
    expect(uxie!.evs.def).toBe(0);
    expect(uxie!.evs.hp).toBe(0);

    // One observation is not enough to solve anything.
    const single = inferSpreads([observe('U-turn', {}, 'Hardy')], sets, 'gen9customgame');
    expect(single.get('p1:uxie')).toBeUndefined();
  });
});
