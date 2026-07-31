import { test, expect } from '@playwright/test';
import { computeBlunders, BLUNDER_SWING } from '../src/lib/eval/graph';

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
});
