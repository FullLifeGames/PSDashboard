import type { DecidedSweep, EvalResult } from '../types.ts';
import { DECIDED_SCORE } from './types.ts';

/** The decided sweep a reader may speak: the root profile names a side and the finished score reads the board at DECIDED_SCORE or beyond for it. */
export function heldDecided(result: Pick<EvalResult, 'score' | 'unanswered'>): DecidedSweep | undefined {
  // On the bank the named side won 77% of all sweeps, 95% of those the score agreed with at this floor, and a coin flip's share where the
  // score sat below 0.6. Read-side only: the profile, the prover's trigger and cached results keep the raw sweep; the near stage stays
  // outside (it speaks of a roll before the decision).
  const decided = result.unanswered?.decided;
  if (!decided) return undefined;
  const toward = decided.side === 'p1' ? result.score : -result.score;
  return toward >= DECIDED_SCORE ? decided : undefined;
}
