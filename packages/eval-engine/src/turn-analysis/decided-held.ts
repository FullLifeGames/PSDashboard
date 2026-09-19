import type { DecidedSweep, EvalResult } from '../types.ts';
import { DECIDED_SCORE } from './types.ts';

/**
 * The decided sweep a reader may speak (round 50): the root profile names a
 * side AND the finished score reads the board at DECIDED_SCORE or beyond
 * for that side. The sweep is pair arithmetic on paper; the search plays the
 * lines out. On the bank the named side won 77% of all sweeps, 95% of the
 * ones the score agreed with at this floor, and a coin flip's share where
 * the score sat below 0.6 (649664 t15-t22 named Medicham-Mega against a bar
 * leaning the other way). Read-side only: the profile, the prover's trigger
 * and cached results keep the raw sweep. The near stage stays outside; it
 * speaks of a roll before the decision (573756 t73 stands at 0.596).
 */
export function heldDecided(result: Pick<EvalResult, 'score' | 'unanswered'>): DecidedSweep | undefined {
  const decided = result.unanswered?.decided;
  if (!decided) return undefined;
  const toward = decided.side === 'p1' ? result.score : -result.score;
  return toward >= DECIDED_SCORE ? decided : undefined;
}
