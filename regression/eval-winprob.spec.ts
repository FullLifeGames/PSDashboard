import { test, expect } from '@playwright/test';
import { DISPLAY_K, winPercent, winProbability, WINPROB_K, wpUnits } from '../src/lib/eval/winprob';

test.describe('win probability mapping', () => {
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
    // Near-certain but NOT ended stays honestly below 100.
    expect(winPercent(0.999)).toBeLessThan(100);
    expect(winPercent(0.999)).toBeGreaterThan(80);
  });
});
