import { test, expect } from '@playwright/test';
import { computeBlunders, selectKeyTurns, BLUNDER_SWING } from '../src/lib/eval/graph';

test.describe('eval graph blunder detection', () => {
  test('flags swings at or above the threshold', () => {
    const scores = [0.1, 0.15, -0.3, -0.25, 0.4];
    // turn 3 swings -0.45, turn 5 swings +0.65
    expect(computeBlunders(scores)).toEqual([3, 5]);
  });

  test('ignores gaps and small drifts', () => {
    const scores = [0.0, null, 0.1, 0.15, null, null, 0.2];
    // null gaps break the comparison chain; drifts stay under the threshold.
    expect(computeBlunders(scores)).toEqual([]);
  });

  test('a swing across a gap is not attributed', () => {
    const scores = [0.5, null, -0.5];
    // Two turns passed — the swing cannot be pinned on one decision.
    expect(computeBlunders(scores)).toEqual([]);
  });

  test('threshold is exported and sane', () => {
    expect(BLUNDER_SWING).toBeGreaterThan(0.1);
    expect(BLUNDER_SWING).toBeLessThan(0.5);
  });

  test('key turns cover both sides of every big swing', () => {
    const scores = [0.1, 0.15, -0.3, -0.25, 0.4];
    // Swings land on turns 3 and 5 — deepen the causing turn and the turn after.
    expect(selectKeyTurns(scores)).toEqual([2, 3, 4, 5]);
  });

  test('key turns respect the cap, biggest swings first', () => {
    const scores = [0, 0.3, 0, 0.4, 0, 0.5, 0];
    // Every step is a swing; a cap of 2 keeps only the biggest pair (0.5).
    expect(selectKeyTurns(scores, 2)).toEqual([5, 6]);
  });

  test('a quiet game needs no deepening', () => {
    expect(selectKeyTurns([0.1, 0.12, 0.15, 0.11])).toEqual([]);
  });
});
