import { test, expect } from 'vitest';
import { analyzeTurn } from '../src/analysis';
import type { EvalResult, RankedChoice } from '../src/types';

/**
 * Round 54: the null-move guard reads the DEFENDER's Tera type, per side.
 * Only p1 has terastallized (Gholdengo to Flying): p2's Earthquake is null
 * because of it, and p1's Shadow Ball into the untouched Snorlax stays null
 * as before. A swapped side pick in signals.ts turns both verdicts around.
 */

const choice = (choiceStr: string, label: string, worstCase: number): RankedChoice =>
  ({ choice: choiceStr, label, worstCase, expected: worstCase, ev: worstCase, punishedBy: 'Reply' });

test("the null guard reads the defender's Tera type from the other side", () => {
  const board: EvalResult = {
    score: 0.1, interval: 0, depthCompleted: 1,
    perSide: {
      p1: [choice('move shadowball', 'Shadow Ball', 0.2)],
      p2: [choice('move earthquake', 'Earthquake', -0.1)],
    },
  };
  const analysis = analyzeTurn({
    turn: 12,
    result: board,
    played: { p1: { kind: 'move', name: 'Shadow Ball', tera: false }, p2: { kind: 'move', name: 'Earthquake', tera: false } },
    playedOutcome: 0.0,
    scoreBefore: 0.1,
    scoreAfter: 0.1,
    actives: { p1: 'Gholdengo', p2: 'Snorlax', gen: 9, p1Tera: 'Flying', p2Tera: null },
  });
  expect(analysis.p2.bestNull?.reason).toBe('Gholdengo (Tera Flying) is immune to Ground-type moves');
  expect(analysis.p1.bestNull?.reason).toBe('Snorlax is immune to Ghost-type moves');
});
