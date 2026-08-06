import { test, expect } from '@playwright/test';
import { winPercent, winProbability, WINPROB_K } from '../src/lib/eval/winprob';

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
    // The doubles eval earns more confidence per point of score.
    expect(winProbability(0.5, true)).toBeGreaterThan(winProbability(0.5));
  });
});
