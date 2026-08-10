import { test, expect } from '@playwright/test';
import { needsSettingsUpgrade, supersedesStored } from '../src/hooks/useEvaluation';

test.describe('settings upgrade decision (merged flow)', () => {
  const prefs = { depth: 2, samples: 3, mode: 'matrix', auto: false, tera: 'auto' } as const;
  test('shallower stored settings upgrade; deeper never downgrade', () => {
    expect(needsSettingsUpgrade(null, prefs)).toBe(true);
    expect(needsSettingsUpgrade({ depth: 1, samples: 1, mode: 'matrix' }, prefs)).toBe(true);
    expect(needsSettingsUpgrade({ depth: 2, samples: 1, mode: 'matrix' }, prefs)).toBe(true);
    expect(needsSettingsUpgrade({ depth: 2, samples: 3, mode: 'matrix' }, prefs)).toBe(false);
    // Deeper/heavier stored results stay shown under lighter prefs.
    expect(needsSettingsUpgrade({ depth: 2, samples: 5, mode: 'matrix' }, prefs)).toBe(false);
    expect(needsSettingsUpgrade({ depth: 2, samples: 3, mode: 'matrix' }, { ...prefs, depth: 1, samples: 1 })).toBe(false);
    // Engine-mode mismatch always re-runs — the fast pass is matrix even
    // for MCTS users, so their selected turns must still get MCTS.
    expect(needsSettingsUpgrade({ depth: 1, samples: 1, mode: 'matrix' }, { ...prefs, mode: 'mcts' })).toBe(true);
    expect(needsSettingsUpgrade({ depth: 2, samples: 1, mode: 'mcts' }, { ...prefs, mode: 'mcts' })).toBe(false);
  });
});

test.describe('graph merge monotonicity', () => {
  test('a shallower pass never overwrites deeper stored data', () => {
    // The re-analyze fast pass (d1s1) used to clobber a deepened turn's
    // graph entry until the key-turn pass restored some of them.
    expect(supersedesStored({ depth: 2, samples: 3, mode: 'matrix' }, { depth: 1, samples: 1, mode: 'matrix' }, 'matrix')).toBe(false);
    expect(supersedesStored({ depth: 1, samples: 1, mode: 'matrix' }, { depth: 2, samples: 3, mode: 'matrix' }, 'matrix')).toBe(true);
    expect(supersedesStored(null, { depth: 1, samples: 1, mode: 'matrix' }, 'matrix')).toBe(true);
    // Equal settings refresh in place.
    expect(supersedesStored({ depth: 2, samples: 3, mode: 'matrix' }, { depth: 2, samples: 3, mode: 'matrix' }, 'matrix')).toBe(true);
    // Both dimensions must hold — deeper but fewer samples is not a superset.
    expect(supersedesStored({ depth: 2, samples: 5, mode: 'matrix' }, { depth: 3, samples: 3, mode: 'matrix' }, 'matrix')).toBe(false);
    expect(supersedesStored({ depth: 2, samples: 5, mode: 'matrix' }, { depth: 3, samples: 5, mode: 'matrix' }, 'matrix')).toBe(true);
  });
  test('cross-mode results replace only toward the configured mode', () => {
    // MCTS prefs: the matrix fast pass must not clobber stored MCTS turns…
    expect(supersedesStored({ depth: 2, samples: 1, mode: 'mcts' }, { depth: 1, samples: 1, mode: 'matrix' }, 'mcts')).toBe(false);
    // …but a user who SWITCHED to matrix gets matrix results again.
    expect(supersedesStored({ depth: 2, samples: 1, mode: 'mcts' }, { depth: 1, samples: 1, mode: 'matrix' }, 'matrix')).toBe(true);
    expect(supersedesStored({ depth: 2, samples: 3, mode: 'matrix' }, { depth: 1, samples: 1, mode: 'mcts' }, 'mcts')).toBe(true);
    // Same-mode MCTS has no depth ordering — it refreshes.
    expect(supersedesStored({ depth: 1, samples: 1, mode: 'mcts' }, { depth: 1, samples: 1, mode: 'mcts' }, 'mcts')).toBe(true);
  });
});
import { computeBlunders, selectKeyTurns, BLUNDER_SWING } from '../src/lib/eval/graph';

test.describe('eval graph blunder detection', () => {
  test('flags the turn whose play created the swing, not the turn after', () => {
    const scores = [0.1, 0.15, -0.3, -0.25, 0.4];
    // The -0.45 swing shows between the turn-2 and turn-3 points — it was
    // PLAYED on turn 2 (scores[t-1] is the start of turn t); same for the
    // +0.65 swing played on turn 4. The marker must match the turn whose
    // analysis explains the swing.
    expect(computeBlunders(scores)).toEqual([2, 4]);
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
