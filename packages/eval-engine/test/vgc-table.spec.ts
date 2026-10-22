import { describe, expect, test } from 'vitest';
import type { Battle } from '@pkmn/sim';
import {
  EVAL_WEIGHTS, FEATURE_WEIGHTS, VGC_DOUBLES_FEATURE_WEIGHTS, createMatchupCache, evalFeatures, evaluatePosition, type EvalFeatures,
} from '../src/eval-function';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * Round 69 (T144, spec decision 19): the Scarlet/Violet VGC table after the
 * explanation of Tailwind near 0 and Coverage below 0. The flag is read right
 * (the board's Tailwind is the simulator's side condition), but the matchup
 * term already reads the doubled speed (speed.ts), and Coverage grows with
 * the same margins as the matchup, so the hand values 68 and 40 priced the
 * same thing twice. The refit on the r69-b0 capture (3,779 positions of 711
 * sets, 20 of 20 seeds out of fold) keeps both at 0 and refits bodies,
 * screens, matchup and Trick Room.
 */

const FORMAT = 'gen9doublescustomgame';
const KEYS = Object.keys(VGC_DOUBLES_FEATURE_WEIGHTS) as (keyof EvalFeatures)[];

/** The static of a board: tanh of the weighted feature sum on the table's scale, as evaluatePosition. */
const scoreOf = (battle: Battle, weights: Record<keyof EvalFeatures, number>): number => {
  const features = evalFeatures(battle, createMatchupCache('vgc'));
  const diff = KEYS.reduce((sum, key) => sum + weights[key] * features[key], 0);
  const teamSize = Math.max(battle.sides[0].pokemon.length, battle.sides[1].pokemon.length, 1);
  return Math.tanh((diff / (teamSize * (EVAL_WEIGHTS.alive + EVAL_WEIGHTS.hp))) * EVAL_WEIGHTS.scale);
};

/** Mirror teams that trade hits at equal speed, so that a doubled speed on one side turns the move order of every race. */
function board(tailwindOnP1: boolean): Battle {
  const mon = () => set('Garchomp', ['earthquake', 'outrage'], { ability: 'Rough Skin', item: 'Leftovers', evs: { hp: 252, atk: 252, def: 4, spa: 0, spd: 0, spe: 0 } });
  const battle = battleOf(FORMAT, [mon(), mon()], [mon(), mon()]);
  if (tailwindOnP1) battle.sides[0].addSideCondition('tailwind', battle.sides[0].active[0]!);
  return battle;
}

describe('the SV VGC table (round 69, T144)', () => {
  test('tailwind and coverage are 0, the refit columns carry the fit, the rest stays', () => {
    const w = VGC_DOUBLES_FEATURE_WEIGHTS;
    expect([w.tailwind, w.coverage]).toEqual([0, 0]);
    // Round 74 (T263): the matchup weight 169 is a candidate 123 until the bank and the VGC holdout decide (D4).
    expect([w.bodies, w.screens, w.matchup, w.trickRoom]).toEqual([177, 48, 123, 54]);
    // Held at the hand values: hazards (R2 flagged), choice mismatch (hold). The S7 pair cell is 0 since the user gate of
    // 13.10. (6b): its 0/1 gate made the VGC score fall as a foe took damage in 24 of 103 HP series (T199 builds a ramp).
    expect([w.hazards, w.choiceMismatch, w.pairFocus]).toEqual([0.75, 40, 0]);
    // Round 69 (S17, T49): the damped boost column replaces the flat one (REPLACEMENT, 20 of 20 seeds once drops count).
    expect([w.boosts, w.boostsBiting]).toEqual([0, 16]);
    expect([w.sweepFastKo, w.sweepFastChip, w.sweepSlowKo, w.sweepSlowChip, w.pairRedirect, w.statusFix]).toEqual([0, 0, 0, 0, 0, 0]);
  });

  test('the other tables keep their Tailwind and Coverage', () => {
    expect(FEATURE_WEIGHTS.tailwind).toBe(8);
    expect(FEATURE_WEIGHTS.coverage).toBe(40);
  });

  test('the flag follows the simulator: Tailwind lasts four turns, the turn it is set included', () => {
    const user = set('Whimsicott', ['tailwind', 'splash'], { ability: 'Prankster' });
    const battle = battleOf(FORMAT, [user, set('Snorlax', ['splash'])], [set('Snorlax', ['splash']), set('Snorlax', ['splash'])]);
    const flags: number[] = [];
    for (let turn = 0; turn < 5; turn++) {
      battle.choose('p1', turn === 0 ? 'move 1, move 1' : 'move 2, move 1');
      battle.choose('p2', 'move 1, move 1');
      flags.push(evalFeatures(battle, createMatchupCache('vgc')).tailwind);
    }
    expect(flags).toEqual([1, 1, 1, 0, 0]);
  });

  test('a one-sided Tailwind is read by the flag and by the matchup, and the VGC score has no weight on the flag', () => {
    const plain = board(false);
    const fast = board(true);
    const cache = () => createMatchupCache('vgc');
    const [off, on] = [evalFeatures(plain, cache()), evalFeatures(fast, cache())];
    // The flag is the simulator's side condition.
    expect(off.tailwind).toBe(0);
    expect(on.tailwind).toBe(1);
    // The matchup already moves with the doubled speed, in the Tailwind side's favour.
    expect(on.matchup).toBeGreaterThan(off.matchup);
    // The score is the weighted sum at the table, where the flag has no weight.
    expect(evaluatePosition(fast, cache())).toBeCloseTo(scoreOf(fast, VGC_DOUBLES_FEATURE_WEIGHTS), 12);
    // With the August flag weight the same board would read higher (the flag priced the speed twice).
    expect(scoreOf(fast, { ...VGC_DOUBLES_FEATURE_WEIGHTS, tailwind: 68 })).toBeGreaterThan(evaluatePosition(fast, cache()));
    expect(VGC_DOUBLES_FEATURE_WEIGHTS.tailwind).toBe(0);
  });
});
