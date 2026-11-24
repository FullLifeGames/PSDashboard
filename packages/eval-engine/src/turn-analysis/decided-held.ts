import type { DecidedSweep, EvalResult } from '../types.ts';
import { DECIDED_SCORE } from './types.ts';

/** The decided sweep a reader may speak: the profile names a side and the score reads DECIDED_SCORE for it. */
export function heldDecided(result: Pick<EvalResult, 'score' | 'unanswered'>): DecidedSweep | undefined {
  // Read-side only: the profile, the prover's trigger and cached results keep the raw sweep.
  const decided = result.unanswered?.decided;
  if (!decided) return undefined;
  const toward = decided.side === 'p1' ? result.score : -result.score;
  return toward >= DECIDED_SCORE ? decided : undefined;
}
