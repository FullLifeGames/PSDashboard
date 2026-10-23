import { describe, expect, test } from 'vitest';
import { Move, calculate } from '@smogon/calc';
import type { PokemonSet } from '@pkmn/sim';
import { inferSpreads } from '../src/spread-inference';
import { buildSolveContext, observationError } from '../src/spreads/fit';
import { buildCalcPokemon } from '../src/calc-build';
import { calcGenerationFor } from '../src/calc-gen';
import { toId } from '../src/ids';
import type { DamageObservation, PokemonEvs } from '../src/types';
import './champions-mod';

/**
 * Round 69 (T132 point 1, spec decision 12): a Speed no move order measures keeps the prior. The ladder gave such a
 * Speed away to an offense or bulk rung for a fit-error difference of 0.00004 to 0.00024 (2663108091 Samurott-Hisui,
 * 750540 Iron Boulder, 22 more bank sets): damage carries no Speed information, so the only thing that took it was the
 * budget. A Speed an order measures (the order refutes the prior and a rung repairs it) still moves.
 */
const WORLDS = [
  { name: 'gen9ou', formatid: 'gen9ou', gen: calcGenerationFor(9), level: 100, max: 252, low: 4 },
  { name: 'gen9doublesou', formatid: 'gen9doublesou', gen: calcGenerationFor(9), level: 100, max: 252, low: 4 },
  { name: 'Champions singles', formatid: 'gen9championsou', gen: calcGenerationFor(0), level: 50, max: 32, low: 2 },
  { name: 'Champions doubles', formatid: 'gen9championsvgc2026regma', gen: calcGenerationFor(0), level: 50, max: 32, low: 2 },
];
type World = (typeof WORLDS)[number];
type Mon = { species: string; side: 'p1' | 'p2'; nature: string; evs: PokemonEvs };

const evs = (spread: Partial<PokemonEvs>): PokemonEvs => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...spread });
const asSet = (m: Mon, level: number, moves: string[]): PokemonSet => ({
  name: m.species, species: m.species, item: '', ability: '', moves, nature: m.nature, evs: m.evs,
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level, gender: '',
});
/** A hit computed forward with the TRUE spreads on the world's generation: the roll at `rollIndex` (0..15). */
function hit(world: World, attacker: Mon, defender: Mon, moveName: string, rollIndex = 8): DamageObservation {
  const body = (m: Mon) => buildCalcPokemon(world.gen, m.species, { level: world.level, nature: m.nature, evs: m.evs });
  const result = calculate(world.gen, body(attacker), body(defender), new Move(world.gen, moveName));
  const rolls = (Array.isArray(result.damage) ? (result.damage as number[]).flat() : [Number(result.damage)]).map(Number);
  return {
    attackerSpecies: attacker.species, defenderSpecies: defender.species, attackerSide: attacker.side,
    moveId: toId(moveName), observedFraction: rolls[Math.min(rollIndex, rolls.length - 1)] / body(defender).maxHP(), lethal: false,
    attackerBoosts: {}, defenderBoosts: {}, attackerStatus: '', screens: [], weather: '',
  };
}
const speedOf = (world: World, m: Mon) => buildCalcPokemon(world.gen, m.species, { level: world.level, nature: m.nature, evs: m.evs }).stats.spe;

for (const world of WORLDS) {
  const { max, low } = world;
  const clefable: Mon = { species: 'Clefable', side: 'p1', nature: 'Bold', evs: evs({ hp: max, def: max }) };
  const toxapex: Mon = { species: 'Toxapex', side: 'p1', nature: 'Bold', evs: evs({ hp: max, def: max }) };
  const lucario: Mon = { species: 'Lucario', side: 'p1', nature: 'Jolly', evs: evs({ atk: max, spe: max }) };
  const prior: Mon = { species: 'Garchomp', side: 'p2', nature: 'Jolly', evs: evs({ atk: max, spe: max }) };
  const bulkyAttacker: Mon = { ...prior, evs: evs({ hp: max, atk: max, spe: low }) };
  const specialWall: Mon = { ...prior, nature: 'Calm', evs: evs({ hp: max, spd: max, spe: low }) };
  const sets = {
    p1: [asSet(clefable, world.level, ['Moonblast']), asSet(toxapex, world.level, ['Scald']), asSet(lucario, world.level, ['Close Combat'])],
    p2: [asSet(prior, world.level, ['Earthquake', 'Swords Dance'])],
  };
  const solve = (observations: DamageObservation[], orders: Parameters<typeof inferSpreads>[3] = []) =>
    inferSpreads(observations, sets, world.formatid, orders).get('p2:garchomp');

  describe(`an unmeasured Speed keeps the prior (${world.name})`, () => {
    test('lines that ask for HP beside the offense leave the Speed alone', () => {
      // Two clean Earthquakes (the top roll on Toxapex) and two Moonblasts from the bulky attacker: the fit wants
      // 252 HP and 252 Atk, and the budget holds them only if the Speed the prior carries goes. No order measured it.
      const observations = [
        hit(world, bulkyAttacker, clefable, 'Earthquake'), hit(world, bulkyAttacker, toxapex, 'Earthquake', 15),
        hit(world, clefable, bulkyAttacker, 'Moonblast'), hit(world, toxapex, bulkyAttacker, 'Scald'),
      ];
      const solved = solve(observations);
      expect(solved?.evs.spe ?? max).toBe(max);
      expect(solved?.nature ?? 'Jolly').toBe('Jolly');
    });

    test('lines that ask for special bulk leave the Speed alone', () => {
      const observations = [
        hit(world, clefable, specialWall, 'Moonblast'), hit(world, clefable, specialWall, 'Moonblast'),
        hit(world, toxapex, specialWall, 'Scald'), hit(world, toxapex, specialWall, 'Scald'),
      ];
      const solved = solve(observations);
      expect(solved?.evs.spe ?? max).toBe(max);
      expect(solved?.nature ?? 'Jolly').toBe('Jolly');
    });

    test('an order the prior breaks still measures the Speed', () => {
      // Garchomp moved after a Jolly Lucario (the scene: the prior outspeeds it). The order refutes the Speed and a
      // lower one repairs it, so the rule does not hold the prior here.
      expect(speedOf(world, prior)).toBeGreaterThan(speedOf(world, lucario));
      const observations = [hit(world, bulkyAttacker, clefable, 'Earthquake'), hit(world, clefable, bulkyAttacker, 'Moonblast')];
      const order = { firstSide: 'p1' as const, firstSpecies: 'Lucario', secondSide: 'p2' as const, secondSpecies: 'Garchomp', turn: 3 };
      // Lucario's spread and item are known, so the Speed the order refutes can only be Garchomp's.
      const known = new Map([['p1:lucario', { itemKnown: true, scarfRuledOut: true, spreadKnown: true, spreads: [] }]]);
      const solved = inferSpreads(observations, sets, world.formatid, [order], known).get('p2:garchomp');
      expect(solved?.evs.spe ?? max).toBeLessThan(max);
    });

    test('the solved body keeps the prior unless the lines move it: the fit error never rises above the prior\'s', () => {
      const observations = [
        hit(world, bulkyAttacker, clefable, 'Earthquake'), hit(world, bulkyAttacker, toxapex, 'Earthquake', 15),
        hit(world, clefable, bulkyAttacker, 'Moonblast'),
      ];
      const solved = solve(observations);
      const ctx = buildSolveContext(observations, sets, world.formatid, []);
      const total = (spread: { evs: PokemonEvs; nature: string }) =>
        observations.reduce((sum, obs) => sum + observationError(ctx, obs, 'p2:garchomp', spread), 0);
      expect(total(solved ?? prior)).toBeLessThanOrEqual(total(prior) + 1e-12);
    });
  });
}
