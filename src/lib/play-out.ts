import type { EvalResult, RankedChoice } from './eval/types';

/** Safety ceiling per play-out run (spec: 100 executed entries). */
export const PLAY_OUT_CAP = 100;

export type PlayOutStep =
  | { kind: 'pair'; p1: RankedChoice; p2: RankedChoice }
  | { kind: 'single'; side: 'p1' | 'p2'; choice: RankedChoice }
  | { kind: 'done'; reason: 'ended' | 'cap' | 'no-choices' };

/**
 * One decision of the engine-vs-engine loop ("Let it play out"): both
 * sides' top ranked choice, a single side's when the position is one-sided
 * (forced switches), or the stop verdict. Pure — the caller owns execution
 * and re-evaluation.
 */
export function nextPlayOutStep(result: EvalResult, battleEnded: boolean, executed: number): PlayOutStep {
  if (battleEnded) return { kind: 'done', reason: 'ended' };
  if (executed >= PLAY_OUT_CAP) return { kind: 'done', reason: 'cap' };
  const p1 = result.perSide.p1[0] ?? null;
  const p2 = result.perSide.p2[0] ?? null;
  if (p1 && p2) return { kind: 'pair', p1, p2 };
  if (p1) return { kind: 'single', side: 'p1', choice: p1 };
  if (p2) return { kind: 'single', side: 'p2', choice: p2 };
  return { kind: 'done', reason: 'no-choices' };
}
