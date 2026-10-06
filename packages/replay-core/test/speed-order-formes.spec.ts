import { describe, expect, test } from 'vitest';
import { Generations, Pokemon } from '@smogon/calc';
import type { PokemonSet } from '@pkmn/sim';
import { inferSpreads } from '../src/spread-inference';
import type { SpeedKnowledge } from '../src/spreads/scarf';
import type { PokemonEvs, SpeedOrderObservation } from '../src/types';

/**
 * Round 63 (T117): an order names the forme that raced. A battle-only forme
 * on the same base Speed as the set it comes from (Ogerpon's Tera masks)
 * binds that set. Round 64 (T122): a forme with its own Speed
 * (Terapagos-Terastal, a Mega) binds the set too, with the forme's base
 * Speed on the set's spread, because that is the Speed that raced.
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

  for (const formatid of ['gen9vgc2026regi', 'gen9ou']) {
    test(`Terapagos-Terastal races on its own base Speed (85) with the Terapagos spread (2630110359 t2 shape, ${formatid})`, () => {
      // Terastal Modest 0 Speed: 206 (the set's Terapagos would be 141); Garchomp Jolly 252: 333.
      const sets = {
        p1: [set('Terapagos', 'Modest', { hp: 252, atk: 0, def: 4, spa: 252, spd: 0, spe: 0 })],
        p2: [set('Garchomp', 'Jolly', { hp: 0, atk: 252, def: 4, spa: 0, spd: 0, spe: 252 })],
      };
      const order: SpeedOrderObservation = {
        firstSide: 'p1', firstSpecies: 'Terapagos-Terastal', secondSide: 'p2', secondSpecies: 'Garchomp', turn: 2,
      };
      const solved = inferSpreads([], sets, formatid, [order], itemKnown(['p1:terapagos', 'p2:garchomp']));
      const terapagos = solved.get('p1:terapagos') ?? sets.p1[0];
      const garchomp = solved.get('p2:garchomp') ?? sets.p2[0];
      expect(speOf('Terapagos-Terastal', terapagos)).toBeGreaterThan(speOf('Garchomp', garchomp));
    });
  }

  for (const formatid of ['gen6ou', 'gen6doublesou']) {
    test(`a Mega races on its own base Speed with the base set's spread (649664 t20 shape, ${formatid})`, () => {
      // Lopunny Jolly 0 Speed: 270, as Lopunny-Mega 336; the known Latias runs Timid 252: 350.
      const sets = {
        p1: [{ ...set('Lopunny', 'Jolly', { hp: 4, atk: 252, def: 0, spa: 0, spd: 252, spe: 0 }), item: 'Lopunnite' }],
        p2: [set('Latias', 'Timid', { hp: 0, atk: 0, def: 4, spa: 252, spd: 0, spe: 252 })],
      };
      const order: SpeedOrderObservation = {
        firstSide: 'p1', firstSpecies: 'Lopunny-Mega', secondSide: 'p2', secondSpecies: 'Latias', turn: 20,
      };
      const known = new Map([...itemKnown(['p1:lopunny']), ['p2:latias', { itemKnown: true, scarfRuledOut: true, spreadKnown: true, spreads: [] }]]);
      const solved = inferSpreads([], sets, formatid, [order], known);
      const lopunny = solved.get('p1:lopunny') ?? sets.p1[0];
      expect(speOf('Lopunny-Mega', lopunny)).toBeGreaterThan(350);
      expect(speOf('Latias', solved.get('p2:latias') ?? sets.p2[0])).toBe(350);
    });
  }
});
