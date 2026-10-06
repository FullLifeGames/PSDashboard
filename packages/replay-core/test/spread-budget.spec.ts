import { describe, expect, test } from 'vitest';
import { Generations, Pokemon, Move, calculate } from '@smogon/calc';
import type { PokemonSet } from '@pkmn/sim';
import { inferSpreads } from '../src/spread-inference';
import { buildSolveContext, observationError } from '../src/spreads/fit';
import { toId } from '../src/ids';
import type { DamageObservation, PokemonEvs } from '../src/types';

/**
 * Round 64 (T122 points 7 and 1): a solve spends its EV budget. The ladder
 * knows offense and bulk only at {0, 252, 252+}, so a winning rung that
 * zeroes both left half the budget open (78 of 1548 bank sets in round 63,
 * Volcanion Hardy 0/0/0/0/0/0). The open budget goes to offense, HP, Def
 * and SpD in the top-up's order, each as far as the damage lines stay as
 * they are; Speed never takes any.
 */
const gen = Generations.get(9);
type Mon = { species: string; side: 'p1' | 'p2'; nature: string; evs: PokemonEvs };
const evs = (hp: number, atk: number, def: number, spa: number, spd: number, spe: number): PokemonEvs => ({ hp, atk, def, spa, spd, spe });
const asSet = (m: Mon, moves: string[]): PokemonSet => ({
  name: m.species, species: m.species, item: '', ability: '', moves, nature: m.nature, evs: m.evs,
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 100, gender: '',
});
/** A mid-roll hit computed forward with the TRUE spreads. */
function hit(attacker: Mon, defender: Mon, moveName: string): DamageObservation {
  const a = new Pokemon(gen, attacker.species, { level: 100, nature: attacker.nature, evs: attacker.evs });
  const d = new Pokemon(gen, defender.species, { level: 100, nature: defender.nature, evs: defender.evs });
  const rolls = (calculate(gen, a, d, new Move(gen, moveName)).damage as number[]).flat().map(Number);
  return {
    attackerSpecies: attacker.species, defenderSpecies: defender.species, attackerSide: attacker.side,
    moveId: toId(moveName), observedFraction: rolls[8] / d.maxHP(), lethal: false,
    attackerBoosts: {}, defenderBoosts: {}, attackerStatus: '', screens: [], weather: '',
  };
}
const total = (spread: PokemonEvs) => Object.values(spread).reduce((sum, value) => sum + value, 0);

describe('a solve spends the budget the damage lines leave open (T122 point 7)', () => {
  // The real Rillaboom runs a small offense and a little HP; the usage prior (Adamant 252 Atk / 252 Spe)
  // hits too hard, so the fit takes the 0-offense rung, and the bulk rung beside it is uninvested.
  const truth: Mon = { species: 'Rillaboom', side: 'p1', nature: 'Hardy', evs: evs(100, 60, 0, 0, 0, 252) };
  const prior: Mon = { ...truth, nature: 'Adamant', evs: evs(0, 252, 4, 0, 0, 252) };
  const garchomp: Mon = { species: 'Garchomp', side: 'p2', nature: 'Jolly', evs: evs(0, 252, 4, 0, 0, 252) };
  const dragonite: Mon = { species: 'Dragonite', side: 'p2', nature: 'Adamant', evs: evs(0, 252, 4, 0, 0, 252) };
  const observations = [hit(truth, garchomp, 'Wood Hammer'), hit(dragonite, truth, 'Extreme Speed')];
  const sets = { p1: [asSet(prior, ['Wood Hammer'])], p2: [asSet(garchomp, ['Earthquake']), asSet(dragonite, ['Extreme Speed'])] };

  for (const formatid of ['gen9ou', 'gen9doublesou']) {
    test(`a rung that zeroes offense and bulk keeps the EVs its damage lines allow (${formatid})`, () => {
      const solved = inferSpreads(observations, sets, formatid)!.get('p1:rillaboom')!;
      expect(total(solved.evs)).toBeGreaterThan(440);
      expect(solved.evs.spe).toBe(252);
      // The filled spread still fits both lines.
      const ctx = buildSolveContext(observations, sets, formatid, []);
      for (const obs of observations) expect(observationError(ctx, obs, 'p1:rillaboom', solved)).toBeLessThan(1e-12);
    });
  }
});

describe('the open budget refills toward the prior first (T122 point 7, round 64 h2)', () => {
  // 573756 shape: the fit takes the physically defensive rung (252 HP / 252 Def) over the specially
  // defensive prior (Calm 252 HP / 252 SpD), which zeroes SpD and leaves 4 EVs open. The lines cannot tell where those
  // 4 go; the prior put its EVs in SpD, so they go there, not into an Attack no line asks for.
  const truth: Mon = { species: 'Toxapex', side: 'p1', nature: 'Bold', evs: evs(252, 0, 252, 0, 4, 0) };
  const prior: Mon = { ...truth, nature: 'Calm', evs: evs(252, 0, 4, 0, 252, 0) };
  const garchomp: Mon = { species: 'Garchomp', side: 'p2', nature: 'Jolly', evs: evs(0, 252, 4, 0, 0, 252) };
  const bolt: Mon = { species: 'Raging Bolt', side: 'p2', nature: 'Modest', evs: evs(0, 0, 4, 252, 0, 252) };
  const observations = [hit(garchomp, truth, 'Earthquake'), hit(bolt, truth, 'Thunderbolt'), hit(truth, garchomp, 'Knock Off')];
  const sets = {
    p1: [asSet(prior, ['Knock Off', 'Recover'])],
    p2: [asSet(garchomp, ['Earthquake']), asSet(bolt, ['Thunderbolt'])],
  };

  for (const formatid of ['gen9ou', 'gen9doublesou']) {
    test(`the 4 EVs the bulk rung leaves open land in SpD as in the prior, not in Attack (${formatid})`, () => {
      const solved = inferSpreads(observations, sets, formatid)!.get('p1:toxapex')!;
      expect(solved.evs).toEqual(evs(252, 0, 252, 0, 4, 0));
    });
  }
});
