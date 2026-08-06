import { test, expect } from '@playwright/test';
import { solveMatrixGame } from '../src/lib/eval/rank';

// Pins the regret-matching solver against games with known solutions. The
// solver is pure math (no sim), deterministic, and reads the AVERAGE
// strategies — the only thing regret matching guarantees converges.
test.describe('zero-sum matrix game solver', () => {
  test('matching pennies solves to the uniform mix at value 0', () => {
    const { value, p1Mix, p2Mix } = solveMatrixGame([[1, -1], [-1, 1]]);
    expect(Math.abs(value)).toBeLessThan(0.02);
    expect(p1Mix[0]).toBeGreaterThan(0.45);
    expect(p1Mix[0]).toBeLessThan(0.55);
    expect(p2Mix[0]).toBeGreaterThan(0.45);
    expect(p2Mix[0]).toBeLessThan(0.55);
  });

  test('a dominant row takes the whole mix', () => {
    const { value, p1Mix } = solveMatrixGame([[1, 1], [0, 0]]);
    expect(p1Mix[0]).toBeGreaterThan(0.95);
    expect(value).toBeGreaterThan(0.95);
  });

  test('a known mixed game hits its analytic solution', () => {
    // [[2,−1],[−1,1]]: p1 plays row 0 with 2/5, game value 1/5.
    const { value, p1Mix } = solveMatrixGame([[2, -1], [-1, 1]]);
    expect(Math.abs(value - 0.2)).toBeLessThan(0.02);
    expect(Math.abs(p1Mix[0] - 0.4)).toBeLessThan(0.03);
  });

  test('a pure saddle point is found exactly', () => {
    // Row 1 / col 0 is a saddle at 2: max of row minima, min of col maxima.
    const { value, p1Mix, p2Mix } = solveMatrixGame([[1, 3], [2, 4]]);
    expect(Math.abs(value - 2)).toBeLessThan(0.02);
    expect(p1Mix[1]).toBeGreaterThan(0.95);
    expect(p2Mix[0]).toBeGreaterThan(0.95);
  });

  test('degenerate shapes do not crash', () => {
    expect(solveMatrixGame([[0.3]]).value).toBeCloseTo(0.3, 10);
    expect(solveMatrixGame([]).p1Mix).toEqual([]);
    expect(solveMatrixGame([[]]).p2Mix).toEqual([]);
  });

  test('the solver is deterministic', () => {
    const first = solveMatrixGame([[0.4, -0.2, 0.1], [-0.1, 0.3, -0.3], [0.0, 0.1, 0.2]]);
    const second = solveMatrixGame([[0.4, -0.2, 0.1], [-0.1, 0.3, -0.3], [0.0, 0.1, 0.2]]);
    expect(second).toEqual(first);
  });
});
