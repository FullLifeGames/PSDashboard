import { test, expect } from '@playwright/test';
import { winPercent, winProbability, WINPROB_K, wpUnits } from '../src/lib/eval/winprob';

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

  test('matches the pinned logistic constants', () => {
    expect(winProbability(0.5, true)).toBeCloseTo(1 / (1 + Math.exp(-WINPROB_K.doubles * 0.5)), 10);
    expect(winProbability(0.5)).toBeCloseTo(1 / (1 + Math.exp(-WINPROB_K.singles * 0.5)), 10);
    // Corpus-fitted 2026-08-08: both gametypes earn similar confidence per
    // point (2.7 / 2.3) — the old singles 0.9 rested on a tiny sample.
    expect(WINPROB_K.singles).toBeGreaterThan(1);
    expect(WINPROB_K.doubles).toBeGreaterThan(1);
  });

  test('wpUnits carries the Jensen effect: variance helps when behind, hurts ahead', () => {
    // Below 50% the sigmoid is convex: a spread of outcomes beats its mean.
    expect(wpUnits(-0.9) + wpUnits(-0.1)).toBeGreaterThan(2 * wpUnits(-0.5));
    // Above 50% it is concave: consolidation beats gambling.
    expect(wpUnits(0.9) + wpUnits(0.1)).toBeLessThan(2 * wpUnits(0.5));
    expect(wpUnits(0)).toBeCloseTo(0, 10);
  });

  test('winPercent is linear over wp-unit scores (no double sigmoid)', () => {
    expect(winPercent(0.5)).toBe(75);
    expect(winPercent(-0.5)).toBe(25);
    expect(winPercent(1)).toBe(100);
  });
});
