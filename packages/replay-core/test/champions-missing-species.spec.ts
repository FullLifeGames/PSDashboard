import { describe, expect, test } from 'vitest';
import { Dex } from '@pkmn/sim';
import * as championsMod from '@pkmn/mods/champions';
import type { PokemonSet } from '@pkmn/sim';
import { buildCalcPokemon, calcKnowsMove } from '../src/calc-build';
import { calcGenerationFor, calcModOf } from '../src/calc-gen';
import { inferSpreads } from '../src/spread-inference';
import { buildSolveContext, hpBasisOf, observationError, speedStat } from '../src/spreads/fit';
import type { DamageObservation } from '../src/types';

/**
 * Round 68 (T186, decision 3 with D8): the spread solver builds every species the Champions mod allows. The calculator's
 * Champions generation 0 lacks 35 of them (Aegislash, the Vivillon patterns, the Alcremie flavors, Minior-Meteor, the Ogerpon
 * Tera formes, ...); each used to throw inside the solver (an observation that never judged, a Speed of 0, no max-HP pin).
 * The solver builds through the shared builder now. It also holds the other half of decision 7: Pound, the one damaging
 * move generation 0 lacks, builds as a 0-damage Status move in the calculator and must read as unreadable, never as a miss.
 * The species come from the mod, the numbers from the simulator's Dex: stat = base + SP + 20, HP = base + SP + 75 at level 50.
 */
Dex.mod('champions', championsMod as unknown as NonNullable<Parameters<typeof Dex.mod>[1]>);
const dex = Dex.dexes.champions;
const FORMATS = { singles: 'gen9championsou', doubles: 'gen9championsvgc2026regmbbo3' } as const;
const legal = dex.species.all().filter(species => !species.isNonstandard);
const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const ALL_31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const mon = (species: string, moves: string[] = ['Protect']): PokemonSet => ({
  name: species, species, item: '', ability: '', moves, nature: 'Hardy', evs: { ...ZERO }, ivs: { ...ALL_31 }, level: 50, gender: '',
});
const observation = (move: string, fraction: number): DamageObservation => ({
  attackerSpecies: 'Garchomp', defenderSpecies: 'Corviknight', attackerSide: 'p1', moveId: move, observedFraction: fraction, lethal: false,
  attackerBoosts: {}, defenderBoosts: {}, attackerStatus: '', screens: [], weather: '',
});

describe('the solver builds every species the Champions mod allows', () => {
  test('the format ids of both game types price on the calculator\'s Champions generation', () => {
    for (const format of Object.values(FORMATS)) expect(calcGenerationFor(9, calcModOf(format)).num, format).toBe(0);
  });

  for (const [kind, format] of Object.entries(FORMATS)) {
    test(`${kind}: Speed, max-HP pin and a judged hit for each of the ${legal.length} legal species`, () => {
      const wrong: string[] = [];
      for (const species of legal) {
        const sets = { p1: [mon(species.name)], p2: [mon('Garchomp', ['Dragon Claw'])] };
        const ctx = buildSolveContext([], sets, format, []);
        const speed = speedStat(ctx, 'p1', species.name, { evs: { ...ZERO }, nature: 'Hardy' });
        const basis = hpBasisOf(ctx, 'p1', species.name);
        if (speed !== species.baseStats.spe + 20) wrong.push(`${species.name} speed ${speed}`);
        if (basis?.baseHp !== species.baseStats.hp) wrong.push(`${species.name} max-HP pin ${basis?.baseHp}`);
        // An impossible hit (150% of the HP, not a knock-out) is a miss whenever the observation judges at all.
        const hit: DamageObservation = { ...observation('dragonclaw', 1.5), attackerSide: 'p2', attackerSpecies: 'Garchomp', defenderSpecies: species.name };
        const error = observationError(buildSolveContext([hit], sets, format, []), hit, `p1:${species.id}`, { evs: { ...ZERO }, nature: 'Hardy' });
        if (!(error > 0)) wrong.push(`${species.name} unjudged`);
      }
      expect(wrong).toEqual([]);
    });

    test(`${kind}: the shared builder gives the mod's stats and types at 0 Stat Points for each legal species`, () => {
      const gen = calcGenerationFor(9, calcModOf(format));
      const wrong: string[] = [];
      for (const species of legal) {
        const built = buildCalcPokemon(gen, species.name, { level: 50, nature: 'Hardy', evs: { ...ZERO } });
        const stats = built.rawStats;
        const expected = { hp: species.baseStats.hp + 75, atk: species.baseStats.atk + 20, def: species.baseStats.def + 20, spa: species.baseStats.spa + 20, spd: species.baseStats.spd + 20, spe: species.baseStats.spe + 20 };
        if (JSON.stringify(stats) !== JSON.stringify(expected) || built.types.join('/') !== species.types.join('/')) wrong.push(species.name);
      }
      expect(wrong).toEqual([]);
    });

    test(`${kind}: a Pound observation leaves the fit unchanged (no judgment, no miss)`, () => {
      const gen = calcGenerationFor(9, 'champions');
      expect(calcKnowsMove(gen, 'Pound'), 'Pound is the move generation 0 lacks').toBe(false);
      expect(calcKnowsMove(gen, 'Dragon Claw')).toBe(true);
      const attacker = { ...mon('Garchomp', ['Dragon Claw', 'Pound']), nature: 'Adamant' };
      const defender = { ...mon('Corviknight', ['Roost']), nature: 'Impish' };
      const sets = { p1: [attacker], p2: [defender] };
      // Two readable hits meet the solver's observation minimum with or without the Pound line (an unreadable line still counts as a line).
      const claws = [observation('dragonclaw', 0.3), observation('dragonclaw', 0.31)];
      const pound = observation('pound', 0.5);
      const ctx = buildSolveContext([pound], sets, format, []);
      expect(observationError(ctx, pound, 'p1:garchomp', { evs: { ...ZERO, atk: 32 }, nature: 'Adamant' })).toBe(0);
      expect(observationError(ctx, pound, 'p1:garchomp', { evs: { ...ZERO }, nature: 'Hardy' })).toBe(0);
      const plain = inferSpreads(claws, sets, format);
      const withPound = inferSpreads([...claws, pound], sets, format);
      expect([...withPound.entries()]).toEqual([...plain.entries()]);
    });
  }
});
