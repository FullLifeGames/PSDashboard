import { test, expect, describe } from 'vitest';
import { CHAMPIONS_WINPROB_K, DISPLAY_K, VGC_WINPROB_K, winPercent, winProbability, WINPROB_K, WINPROB_K_OF, winprobK, wpUnits } from '../src/winprob';
import type { StaticRuleset } from '../src/score/weights';

describe('win probability mapping', () => {
  test('an even score is a coin flip in both game types', () => {
    expect(winProbability(0)).toBeCloseTo(0.5, 10);
    expect(winProbability(0, true)).toBeCloseTo(0.5, 10);
    expect(winPercent(0)).toBe(50);
  });

  test('monotone and symmetric', () => {
    expect(winProbability(0.5)).toBeGreaterThan(winProbability(0.2));
    expect(winProbability(-0.3)).toBeCloseTo(1 - winProbability(0.3), 10);
  });

  test('phase-aware K: confidence grows with the fainted fraction', () => {
    expect(winProbability(0.5, false, 0)).toBeCloseTo(1 / (1 + Math.exp(-WINPROB_K.singles.k0 * 0.5)), 10);
    const late = winProbability(0.5, false, 0.8);
    const early = winProbability(0.5, false, 0);
    // Adopted k1 > 0: the same score claims more late than early.
    if (WINPROB_K.singles.k1 > 0) expect(late).toBeGreaterThan(early);
    expect(winProbability(0, true, 0.5)).toBeCloseTo(0.5, 10);
    // Corpus-fitted 2026-08-09 (phase-K): confidence per point stays >1 at
    // every phase in both gametypes.
    expect(WINPROB_K.singles.k0).toBeGreaterThan(1);
    expect(WINPROB_K.doubles.k0).toBeGreaterThan(1);
  });

  // Round 67 (T138), reshaped in round 74 (T163): a rule set prices its own scale. Champions doubles did so since
  // round 67 (1.86 + 4.17 × the fainted share, fitted on its corpus games in the Champions mod); since round 74 every
  // family has an entry of its own. The default rule set is the standard one.
  test('round 67 (T138): every rule set resolves its own phase K through winProbability and wpUnits', () => {
    const p = (k: { k0: number; k1: number }) => 1 / (1 + Math.exp(-(k.k0 + k.k1 * 0.5) * 0.4));
    expect(winProbability(0.4, true, 0.5, 'champions')).toBeCloseTo(p(CHAMPIONS_WINPROB_K.doubles), 12);
    expect(wpUnits(0.4, true, 0.5, 'champions')).toBeCloseTo(2 * p(CHAMPIONS_WINPROB_K.doubles) - 1, 12);
    for (const doubles of [false, true]) {
      const gameType = doubles ? 'doubles' : 'singles';
      for (const ruleset of ['standard', 'vgc', 'champions'] as const) {
        expect(winProbability(0.4, doubles, 0.5, ruleset), `${ruleset} ${gameType}`).toBeCloseTo(p(WINPROB_K_OF[ruleset][gameType]), 12);
      }
      expect(winProbability(0.4, doubles, 0.5)).toBeCloseTo(p(WINPROB_K[gameType]), 12);
    }
  });

  // Round 74 (T163): every family resolves its own K entry, so a fit moves one family and no other. The five values
  // are the candidates of the fit on the search's own root values (a weight pin, not a verdict: the bank and the
  // holdouts decide by D4), and none of them shares an object with another.
  test('round 74 (T163): the five families hold their candidate K, each in its own entry', () => {
    const today = {
      'standard-singles': { k0: 2.81, k1: 0.8 },
      'standard-doubles': { k0: 2.95, k1: 1.11 },
      'vgc-doubles': { k0: 2.09, k1: 1.13 },
      'champions-singles': { k0: 2.05, k1: 3.22 },
      'champions-doubles': { k0: 1.8, k1: 3.07 },
    } as const;
    const entries = new Map<string, object>();
    for (const [family, k] of Object.entries(today)) {
      const [ruleset, gameType] = family.split('-') as [StaticRuleset, string];
      const resolved = winprobK(gameType === 'doubles', ruleset);
      expect(resolved, family).toEqual(k);
      entries.set(family, resolved);
    }
    expect(new Set(entries.values()).size).toBe(5);
    expect(VGC_WINPROB_K.doubles).toEqual({ k0: 2.09, k1: 1.13 });
    expect(winprobK(true, 'vgc')).toBe(VGC_WINPROB_K.doubles);
    expect(winprobK(false, 'vgc')).toBe(VGC_WINPROB_K.singles);
    expect(winprobK(false, 'champions')).toBe(CHAMPIONS_WINPROB_K.singles);
    expect(winprobK(true)).toBe(WINPROB_K.doubles);
  });

  test('wpUnits carries the Jensen effect: variance helps when behind, hurts ahead', () => {
    // Below 50% the sigmoid is convex: a spread of outcomes beats its mean.
    expect(wpUnits(-0.9) + wpUnits(-0.1)).toBeGreaterThan(2 * wpUnits(-0.5));
    // Above 50% it is concave: consolidation beats gambling.
    expect(wpUnits(0.9) + wpUnits(0.1)).toBeLessThan(2 * wpUnits(0.5));
    expect(wpUnits(0)).toBeCloseTo(0, 10);
  });

  test('winPercent is the calibrated display map: sigmoid(DISPLAY_K·s), ended ±1 literal', () => {
    // Two-stage calibration, both measured: the leaf sigmoid calibrates
    // static evals into leaf win-probs; averaging plus equilibrium
    // selection re-inflates the aggregated ROOT score, and DISPLAY_K
    // (fit-corpus-trained, grand-bed-graded) prices that back out at the
    // display boundary. The old linear display was overconfident
    // out-of-sample in every bucket.
    expect(winPercent(0)).toBe(50);
    expect(winPercent(0.5)).toBe(Math.round(100 / (1 + Math.exp(-DISPLAY_K * 0.5))));
    expect(winPercent(0.5)).toBeLessThan(75);
    expect(winPercent(-0.5)).toBe(100 - winPercent(0.5));
    // Exact ±1 is an ENDED evaluation — a finished game displays finished.
    expect(winPercent(1)).toBe(100);
    expect(winPercent(-1)).toBe(0);
    // An ended row weighted by an equilibrium mix keeps a one-bit rounding
    // remnant (573756 t139: every reply to Stomping Tantrum ends at 1, the
    // mix sums to 0.9999999999999999); that is still the finished game.
    expect(winPercent(0.9999999999999999)).toBe(100);
    expect(winPercent(-0.9999999999999999)).toBe(0);
    // Near-certain but NOT ended stays honestly below 100.
    expect(winPercent(0.999)).toBeLessThan(100);
    expect(winPercent(0.999)).toBeGreaterThan(80);
  });
});
