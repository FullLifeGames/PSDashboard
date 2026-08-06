/**
 * Score → win-probability mapping fitted to real replay outcomes (the
 * logistic fit lives in regression/eval-calibration.spec.ts; run it with
 * EVAL_CALIBRATION=1 and pin the printed K here when adopting a new fit).
 * Display-only: engine internals stay in raw score space. Pure, sim-free.
 *
 * Fitted 2026-08-04: singles K=0.88, doubles K=2.80 (pooled 1.27). The gap is
 * real — the doubles eval is better calibrated per point of score — so the
 * mapping selects by gametype instead of averaging both into mush.
 */
export const WINPROB_K = { singles: 0.9, doubles: 2.8 } as const;

/** P(the score's side wins), from p1's perspective like the score itself. */
export function winProbability(score: number, doubles = false): number {
  const k = doubles ? WINPROB_K.doubles : WINPROB_K.singles;
  return 1 / (1 + Math.exp(-k * score));
}

/** Rounded percent for display. */
export const winPercent = (score: number, doubles = false): number =>
  Math.round(100 * winProbability(score, doubles));
