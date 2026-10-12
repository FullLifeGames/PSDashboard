import { describe, expect, test } from 'vitest';
import { Move, calculate } from '@smogon/calc';
import type { PokemonSet } from '@pkmn/sim';
import { inferSpreads } from '../src/spread-inference';
import { buildSolveContext, observationError, speedError } from '../src/spreads/fit';
import { buildCalcPokemon } from '../src/calc-build';
import { calcGenerationFor } from '../src/calc-gen';
import { toId } from '../src/ids';
import type { DamageObservation, PokemonEvs } from '../src/types';

/**
 * Round 69 (T26, spec decision 7): a satisfied move order keeps the Speed the build holds, and the ladder used to
 * keep the plus nature of that Speed with it (Jolly), so an attacker whose clean lines read 10 % harder than Jolly
 * can deal stayed a Jolly attacker. The ladder now also offers the offense nature of the seen hit class beside the
 * kept Speed; bestRung decides by the observation error plus the order price, so the tempo gives way only when the
 * offense lowers the fit error and the order still holds. Bulk natures never open, a kept offense never gives way.
 */
const WORLDS = [
  { name: 'gen9ou', formatid: 'gen9ou', gen: calcGenerationFor(9), level: 100, max: 252 },
  { name: 'gen9doublesou', formatid: 'gen9doublesou', gen: calcGenerationFor(9), level: 100, max: 252 },
  { name: 'Champions singles', formatid: 'gen9championsou', gen: calcGenerationFor(0), level: 50, max: 32 },
  { name: 'Champions doubles', formatid: 'gen9championsvgc2026regma', gen: calcGenerationFor(0), level: 50, max: 32 },
];
type World = (typeof WORLDS)[number];
type Mon = { species: string; side: 'p1' | 'p2'; nature: string; evs: PokemonEvs };

const evs = (spread: Partial<PokemonEvs>): PokemonEvs => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...spread });
const asSet = (m: Mon, level: number, moves: string[]): PokemonSet => ({
  name: m.species, species: m.species, item: '', ability: '', moves, nature: m.nature, evs: m.evs,
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level, gender: '',
});
/** A hit computed forward with the TRUE spreads on the world's generation: the roll at `rollIndex` (0..15). */
function hit(world: World, attacker: Mon, defender: Mon, moveName: string, rollIndex = 15): DamageObservation {
  const body = (m: Mon) => buildCalcPokemon(world.gen, m.species, { level: world.level, nature: m.nature, evs: m.evs });
  const a = body(attacker);
  const d = body(defender);
  const result = calculate(world.gen, a, d, new Move(world.gen, moveName));
  const rolls = (Array.isArray(result.damage) ? (result.damage as number[]).flat() : [Number(result.damage)]).map(Number);
  return {
    attackerSpecies: attacker.species, defenderSpecies: defender.species, attackerSide: attacker.side,
    moveId: toId(moveName), observedFraction: rolls[Math.min(rollIndex, rolls.length - 1)] / d.maxHP(), lethal: false,
    attackerBoosts: {}, defenderBoosts: {}, attackerStatus: '', screens: [], weather: '',
  };
}
const speedOf = (world: World, m: Mon) => buildCalcPokemon(world.gen, m.species, { level: world.level, nature: m.nature, evs: m.evs }).stats.spe;
const first = (side: 'p1' | 'p2', species: string, secondSpecies: string) => ({
  firstSide: side, firstSpecies: species, secondSide: side === 'p1' ? 'p2' as const : 'p1' as const, secondSpecies, turn: 3,
});

for (const world of WORLDS) {
  const { max } = world;
  const clefable: Mon = { species: 'Clefable', side: 'p1', nature: 'Bold', evs: evs({ hp: max, def: max }) };
  const toxapex: Mon = { species: 'Toxapex', side: 'p1', nature: 'Bold', evs: evs({ hp: max, def: max }) };
  const lucario: Mon = { species: 'Lucario', side: 'p1', nature: 'Jolly', evs: evs({ atk: max, spe: max }) };

  describe(`the offense nature opens beside a kept Speed (${world.name})`, () => {
    const prior: Mon = { species: 'Garchomp', side: 'p2', nature: 'Jolly', evs: evs({ atk: max, spe: max }) };
    const truth: Mon = { ...prior, nature: 'Adamant' };
    const sets = {
      p1: [asSet(clefable, world.level, ['Moonblast']), asSet(toxapex, world.level, ['Scald']), asSet(lucario, world.level, ['Close Combat'])],
      p2: [asSet(prior, world.level, ['Earthquake', 'Swords Dance'])],
    };
    const lines = (body: Mon) => [
      hit(world, body, clefable, 'Earthquake'), hit(world, body, toxapex, 'Earthquake'), hit(world, body, clefable, 'Earthquake'),
    ];
    const solve = (observations: DamageObservation[], opponent = 'Clefable') =>
      inferSpreads(observations, sets, world.formatid, [first('p2', 'Garchomp', opponent)]).get('p2:garchomp');

    test('clean lines of a stronger nature than the kept Jolly give the Adamant body, Speed kept', () => {
      const solved = solve(lines(truth));
      expect(solved?.nature).toBe('Adamant');
      expect(solved?.evs.atk).toBe(max);
      expect(solved?.evs.spe).toBe(max);
    });

    test('the order price keeps the Jolly body when the Adamant body would no longer move first', () => {
      // The scene itself: Jolly Garchomp outspeeds Jolly Lucario, Adamant Garchomp does not.
      expect(speedOf(world, prior)).toBeGreaterThan(speedOf(world, lucario));
      expect(speedOf(world, truth)).toBeLessThan(speedOf(world, lucario));
      const solved = solve(lines(truth), 'Lucario');
      expect(solved?.nature ?? 'Jolly').toBe('Jolly');
      expect(solved?.evs.spe ?? max).toBe(max);
    });

    test('lines the Jolly body already fits keep it (the tempo gives way only for a lower fit error)', () => {
      const solved = solve(lines(prior));
      expect(solved?.nature ?? 'Jolly').toBe('Jolly');
      expect(solved?.evs.spe ?? max).toBe(max);
    });

    test('a bulk nature never takes the kept Speed, whatever the defender lines read', () => {
      const bulky = [...lines(truth), hit(world, clefable, truth, 'Moonblast'), hit(world, toxapex, truth, 'Scald')];
      const solved = solve(bulky);
      expect(['Jolly', 'Adamant']).toContain(solved?.nature ?? 'Jolly');
    });

    test('the fit error of the solved body does not rise above the prior\'s', () => {
      for (const body of [truth, prior]) {
        const observations = lines(body);
        const solved = solve(observations)!;
        const ctx = buildSolveContext(observations, sets, world.formatid, [first('p2', 'Garchomp', 'Clefable')]);
        const total = (spread: { evs: PokemonEvs; nature: string }) =>
          observations.reduce((sum, obs) => sum + observationError(ctx, obs, 'p2:garchomp', spread), 0) + speedError(ctx, 'p2:garchomp', spread);
        expect(total(solved ?? prior)).toBeLessThanOrEqual(total(prior) + 1e-12);
      }
    });
  });

  describe(`the opening follows the seen hit class (${world.name})`, () => {
    const prior: Mon = { species: 'Gengar', side: 'p2', nature: 'Timid', evs: evs({ spa: max, spe: max }) };
    const truth: Mon = { ...prior, nature: 'Modest' };
    const sets = {
      p1: [asSet(clefable, world.level, ['Moonblast']), asSet(toxapex, world.level, ['Scald'])],
      p2: [asSet(prior, world.level, ['Shadow Ball', 'Sludge Bomb'])],
    };

    test('special lines open Modest, not a physical or bulk nature', () => {
      const observations = [hit(world, truth, clefable, 'Shadow Ball'), hit(world, truth, toxapex, 'Shadow Ball'), hit(world, truth, clefable, 'Shadow Ball')];
      const solved = inferSpreads(observations, sets, world.formatid, [first('p2', 'Gengar', 'Clefable')]).get('p2:gengar');
      expect(solved?.nature).toBe('Modest');
      expect(solved?.evs.spa).toBe(max);
      expect(solved?.evs.spe).toBe(max);
    });
  });
}

// The old assertions about the nature block stay where the game forces them (see spread-ladder-release.spec.ts):
// a Bulk rung never gives held tempo (573756 t73) and a held offense never gives way (round 33).
test('a Pokemon without clean attacker lines never gets an offense nature from the opening', () => {
  const world = WORLDS[0];
  const prior: Mon = { species: 'Garchomp', side: 'p2', nature: 'Jolly', evs: evs({ atk: 252, spe: 252 }) };
  const clefable: Mon = { species: 'Clefable', side: 'p1', nature: 'Bold', evs: evs({ hp: 252, def: 252 }) };
  const sets = { p1: [asSet(clefable, 100, ['Moonblast'])], p2: [asSet(prior, 100, ['Earthquake'])] };
  const observations = [hit(world, clefable, prior, 'Moonblast'), hit(world, clefable, prior, 'Moonblast')];
  const solved = inferSpreads(observations, sets, 'gen9ou', [first('p2', 'Garchomp', 'Clefable')]).get('p2:garchomp');
  expect(solved?.nature ?? 'Jolly').toBe('Jolly');
});
