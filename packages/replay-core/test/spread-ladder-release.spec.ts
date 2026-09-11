import { describe, expect, test } from 'vitest';
import { Generations, Pokemon, Move, calculate } from '@smogon/calc';
import type { PokemonSet } from '@pkmn/sim';
import { inferSpreads } from '../src/spread-inference';
import { toId } from '../src/ids';
import type { DamageObservation } from '../src/types';

/**
 * Round 41: the budget cannot always hold the log's HP, a measured offense
 * and the prior's kept Speed together. A kept stat is an unmeasured prior
 * value; where a measurement needs its room, it gives way, and the fit
 * decides between the bodies. Where nothing measures, the round-40 body
 * stands.
 */
const gen = Generations.get(9);
type Side = { species: string; side: 'p1' | 'p2'; nature: string; evs: PokemonSet['evs'] };
const mon = (species: string, side: 'p1' | 'p2', nature: string, evs: PokemonSet['evs']): Side => ({ species, side, nature, evs });
const asSet = (m: Side, moves: string[]): PokemonSet => ({
  name: m.species, species: m.species, item: '', ability: '', moves, nature: m.nature, evs: m.evs,
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 100, gender: '',
});
/** A hit computed forward with the TRUE spreads: the mid roll, or the roll at `rollIndex` (0..15). */
function hit(attacker: Side, defender: Side, moveName: string, lethal = false, rollIndex = 8): DamageObservation {
  const a = new Pokemon(gen, attacker.species, { level: 100, nature: attacker.nature, evs: attacker.evs });
  const d = new Pokemon(gen, defender.species, { level: 100, nature: defender.nature, evs: defender.evs });
  const result = calculate(gen, a, d, new Move(gen, moveName));
  const rolls = (Array.isArray(result.damage) ? (result.damage as number[]).flat() : [Number(result.damage)]).map(Number);
  return {
    attackerSpecies: attacker.species, defenderSpecies: defender.species, attackerSide: attacker.side,
    moveId: toId(moveName), observedFraction: rolls[Math.min(rollIndex, rolls.length - 1)] / d.maxHP(), lethal,
    attackerBoosts: {}, defenderBoosts: {}, attackerStatus: '', screens: [], weather: '',
  };
}
const evTotal = (evs: Record<string, number> | undefined) => Object.values(evs ?? {}).reduce((sum, value) => sum + value, 0);

const offensive = { hp: 0, atk: 252, def: 0, spa: 0, spd: 4, spe: 252 };
const bulkyAttacker = { hp: 252, atk: 252, def: 0, spa: 0, spd: 0, spe: 4 };
const garchomp = mon('Garchomp', 'p2', 'Jolly', offensive);
const clefable = mon('Clefable', 'p1', 'Bold', { hp: 252, atk: 0, def: 252, spa: 0, spd: 4, spe: 0 });
const toxapex = mon('Toxapex', 'p1', 'Bold', { hp: 252, atk: 0, def: 252, spa: 0, spd: 4, spe: 0 });
const beforeClefable = { firstSide: 'p2' as const, firstSpecies: 'Garchomp', secondSide: 'p1' as const, secondSpecies: 'Clefable', turn: 3 };
const maxHp420 = new Map([['p2:garchomp', { maxhp: 420, level: 100 }]]);

describe('a kept Speed gives way to a measured offense (round 41)', () => {
  const truth = { ...garchomp, nature: 'Adamant', evs: bulkyAttacker };
  const sets = {
    p1: [asSet(clefable, ['Moonblast']), asSet(toxapex, ['Scald'])],
    p2: [asSet(garchomp, ['Earthquake', 'Swords Dance'])],
  };
  // Two clean Earthquakes from the real Adamant 252 Atk body; the top roll
  // on Toxapex puts the line above what a Hardy body can deal.
  const observations = [hit(truth, clefable, 'Earthquake'), hit(truth, toxapex, 'Earthquake', false, 15)];

  for (const formatid of ['gen9ou', 'gen9doublesou']) {
    test(`a measured offense outlasts a kept Speed beside the log's HP (${formatid})`, () => {
      // Prior Jolly 252 Atk / 252 Spe, the log says 420 HP (252 HP EVs), the
      // order Garchomp-before-Clefable is satisfied by the prior (Speed
      // kept), the Earthquakes measure 252 Atk. Round 40 dropped every
      // offense rung the budget could not express beside the kept Speed and
      // solved Jolly 252/0/0/0/4/252 (sim Earthquake 75% of the hit).
      const solved = inferSpreads(observations, sets, formatid, [beforeClefable], new Map(), maxHp420).get('p2:garchomp');
      expect(solved?.evs.hp).toBe(252);
      expect(solved?.evs.atk).toBe(252);
      expect(solved?.evs.spe ?? 0).toBeLessThanOrEqual(4);
      expect(evTotal(solved?.evs)).toBeLessThanOrEqual(508);
      expect(solved?.nature).toBe('Adamant');
    });
  }

  test('without the HP reading the prior stands, without the order the fit was already right', () => {
    const noHp = inferSpreads(observations, sets, 'gen9ou', [beforeClefable]).get('p2:garchomp');
    expect(noHp?.evs ?? offensive).toEqual(offensive);
    expect(noHp?.nature ?? 'Jolly').toBe('Jolly');
    const noOrder = inferSpreads(observations, sets, 'gen9ou', [], new Map(), maxHp420).get('p2:garchomp');
    expect(noOrder?.evs).toEqual(bulkyAttacker);
  });

  test('a bulk claim beside an expressed offense claim does not release the kept Speed', () => {
    // No HP reading: the offense rung fits beside the kept Speed (the prior
    // itself), only the 252-HP claim riding with it is shaved. Round 41
    // releases Speed for the offense claim's own room, never for a bulk
    // claim (573756 t73 before round 40: a bulk rung stripped the Speed).
    // The fit corpus measured the wider rule at 162 bodies that lost their
    // Speed to a bulk claim beside an unchanged offense; that reading is a
    // registered candidate, not this round's rule.
    const defenderLines = [hit(clefable, truth, 'Moonblast'), hit(toxapex, truth, 'Scald')];
    const solved = inferSpreads([...observations, ...defenderLines], sets, 'gen9ou', [beforeClefable]).get('p2:garchomp');
    expect(solved?.evs.spe ?? 252).toBe(252);
    expect(solved?.nature ?? 'Jolly').toBe('Jolly');
  });

  test('the released Speed must still satisfy the observed orders', () => {
    // Garchomp moved before a Jolly 252 Spe Lucario (306): the prior's 333
    // satisfies it, the released bodies (241 Hardy, 265 Jolly) do not. The
    // order is proof, the damage only a bound: Speed stays, the offense goes.
    const lucario = mon('Lucario', 'p1', 'Jolly', { hp: 0, atk: 252, def: 0, spa: 0, spd: 4, spe: 252 });
    const withLucario = { p1: [...sets.p1, asSet(lucario, ['Close Combat'])], p2: sets.p2 };
    const beforeLucario = { ...beforeClefable, secondSpecies: 'Lucario' };
    const solved = inferSpreads(observations, withLucario, 'gen9ou', [beforeLucario], new Map(), maxHp420).get('p2:garchomp');
    expect(solved?.evs.spe).toBe(252);
    expect(solved?.nature).toBe('Jolly');
    expect(solved?.evs.atk).toBe(0);
  });
});

describe('two kept stats over the budget (round 41)', () => {
  const sets = {
    p1: [asSet(clefable, ['Moonblast'])],
    p2: [asSet(garchomp, ['Earthquake', 'Swords Dance'])],
  };
  const shaved = { ...garchomp, evs: { hp: 252, atk: 4, def: 0, spa: 0, spd: 0, spe: 252 } };
  const full = { ...garchomp, nature: 'Hardy', evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 0, spe: 4 } };
  const maxRoll = (attacker: Side) => hit(attacker, clefable, 'Earthquake', true, 15).observedFraction;

  test('a knock-out the shaved offense cannot reach frees the kept Speed', () => {
    // Knock-out-only offense (kept), the log's 420 HP (fixed), a satisfied
    // order (Speed kept): 252 + 252 + 252 do not fit. Round 40 shaved the
    // kept Atk to 4 by the kept order (Jolly 252/4/0/0/0/252) with nothing
    // measuring it; a knock-out that a 4-Atk body cannot deal now picks the
    // body that can (knock-out lines are lower bounds).
    expect(maxRoll(full)).toBeGreaterThan(maxRoll(shaved) + 0.04);
    const ko = (maxRoll(shaved) + 0.02 + maxRoll(full)) / 2;
    const observations = [
      { ...hit(garchomp, clefable, 'Earthquake', true), observedFraction: ko },
      hit(clefable, full, 'Moonblast'),
    ];
    const solved = inferSpreads(observations, sets, 'gen9ou', [beforeClefable], new Map(), maxHp420).get('p2:garchomp');
    expect(solved?.evs).toEqual(full.evs);
    expect(solved?.nature).toBe('Hardy');
  });

  test('a knock-out both bodies reach keeps the round-40 body (the prior nature breaks the tie)', () => {
    const observations = [
      { ...hit(garchomp, clefable, 'Earthquake', true), observedFraction: maxRoll(shaved) - 0.05 },
      hit(clefable, full, 'Moonblast'),
    ];
    const solved = inferSpreads(observations, sets, 'gen9ou', [beforeClefable], new Map(), maxHp420).get('p2:garchomp');
    expect(solved?.evs).toEqual(shaved.evs);
    expect(solved?.nature).toBe('Jolly');
  });
});
