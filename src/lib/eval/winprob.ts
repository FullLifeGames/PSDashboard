/**
 * Score → win-probability mapping fitted to real replay outcomes (the
 * logistic fit lives in regression/eval-calibration.spec.ts and the larger
 * corpus refit in regression/eval-fit.spec.ts; pin the printed K here when
 * adopting a new fit).
 *
 * Fitted 2026-08-08 on the 1100-game pinned corpus (eval-fit harness, leaf
 * scores vs outcomes): singles K=2.62 (n=3540, kept at 2.7 — within the
 * bootstrap noise of the prior fit), doubles K=3.09 (n=2436) — replacing
 * the doubles 2.3 that rested on only 49 games. The mapping still selects
 * by gametype.
 *
 * Since the win-prob-space conversion, the sigmoid applies ONCE, at the
 * search leaf (`wpUnits`): every downstream value — cell averages, the
 * equilibrium solve, EvalResult.score, regret — lives in wp-units
 * (2p−1 ∈ [−1, +1]). Averaging wp-units averages probabilities, which is
 * what makes variance genuinely valuable when behind (Jensen) instead of
 * being flattened by score-space means. Display is therefore LINEAR.
 */
export const WINPROB_K = { singles: 2.7, doubles: 3.1 } as const;

/** P(the RAW score's side wins) — the leaf mapping's core. */
export function winProbability(score: number, doubles = false): number {
  const k = doubles ? WINPROB_K.doubles : WINPROB_K.singles;
  return 1 / (1 + Math.exp(-k * score));
}

/** Raw leaf score → win-prob units (2p−1, still in [−1, +1]). */
export const wpUnits = (score: number, doubles = false): number =>
  2 * winProbability(score, doubles) - 1;

/** Rounded percent for display — LINEAR: scores are wp-units already. */
export const winPercent = (score: number): number =>
  Math.round(100 * (score + 1) / 2);
