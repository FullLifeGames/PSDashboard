import { describe, expect, test } from 'vitest';
import { Generations, Pokemon } from '@smogon/calc';
import type { PokemonSet } from '@pkmn/sim';
import { inferSpreads } from '../src/spread-inference';
import type { SpeedKnowledge } from '../src/spreads/scarf';
import type { PokemonEvs, SpeedOrderObservation } from '../src/types';

/**
 * Round 63 (T117): an order names the forme that raced. A battle-only forme
 * on the same base Speed as the set it comes from (Ogerpon's Tera masks)
 * binds that set; a forme with its own Speed (Terapagos-Terastal, a Mega)
 * stays unread, because the set's Speed is not the one that raced.
 */
const gen = Generations.get(9);
const set = (species: string, nature: string, evs: PokemonEvs): PokemonSet => ({
  name: species, species, item: '', ability: '', moves: ['Protect'], nature, evs,
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 100, gender: '',
});
const itemKnown = (keys: string[]): Map<string, SpeedKnowledge> => new Map(keys.map(key => [key, {
  itemKnown: true, scarfRuledOut: true, spreadKnown: false, spreads: [],
}]));
const speOf = (species: string, spread: { nature: string; evs: PokemonEvs }) =>
  new Pokemon(gen, species, { nature: spread.nature, evs: spread.evs }).stats.spe;

describe('battle formes in move orders', () => {
  for (const formatid of ['gen9ou', 'gen9doublesou']) {
    test(`an order naming Ogerpon-Wellspring-Tera binds the Ogerpon-Wellspring set (913996 t9, ${formatid})`, () => {
      // Landorus (Timid 252: 331) moved before the terastallized Ogerpon (Jolly 252: 350).
      const sets = {
        p1: [set('Ogerpon-Wellspring', 'Jolly', { hp: 120, atk: 136, def: 0, spa: 0, spd: 0, spe: 252 })],
        p2: [set('Landorus', 'Timid', { hp: 0, atk: 0, def: 4, spa: 252, spd: 0, spe: 252 })],
      };
      const order: SpeedOrderObservation = {
        firstSide: 'p2', firstSpecies: 'Landorus', secondSide: 'p1', secondSpecies: 'Ogerpon-Wellspring-Tera', turn: 9,
      };
      const solved = inferSpreads([], sets, formatid, [order], itemKnown(['p1:ogerponwellspring', 'p2:landorus']));
      const ogerpon = solved.get('p1:ogerponwellspring') ?? sets.p1[0];
      expect(speOf('Ogerpon-Wellspring', ogerpon)).toBeLessThanOrEqual(331);
    });
  }

  test('Terapagos-Terastal stays unread: its own Speed (85) is not the set\'s (60)', () => {
    const sets = {
      p1: [set('Terapagos', 'Modest', { hp: 252, atk: 0, def: 4, spa: 252, spd: 0, spe: 0 })],
      p2: [set('Garchomp', 'Jolly', { hp: 0, atk: 252, def: 4, spa: 0, spd: 0, spe: 252 })],
    };
    const order: SpeedOrderObservation = {
      firstSide: 'p1', firstSpecies: 'Terapagos-Terastal', secondSide: 'p2', secondSpecies: 'Garchomp', turn: 2,
    };
    const solved = inferSpreads([], sets, 'gen9vgc2026regi', [order], itemKnown(['p1:terapagos', 'p2:garchomp']));
    expect([...solved.keys()]).toEqual([]);
  });
});
