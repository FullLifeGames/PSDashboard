/**
 * Score → win-probability mapping fitted to real replay outcomes (the
 * logistic fit lives in regression/eval-calibration.spec.ts and the larger
 * corpus refit in regression/eval-fit.spec.ts; pin the printed K here when
 * adopting a new fit).
 *
 * PHASE-AWARE since 2026-08-09: K = k0 + k1·faintedFraction (fainted bodies
 * over total bodies, both sides — a game-length-independent phase signal).
 * Fitted on the 1,100-game pinned corpus (eval-fit schema 2, 5,985
 * positions): singles k0=2.28 k1=1.49 (n=3551), doubles k0=2.98 k1=0.88
 * (n=2434). Phase-K beat constant-K (2.61/3.15) on held-in Brier in every
 * phase bucket of both gametypes — the early game genuinely earns LESS
 * confidence per point than the endgame, which is the measured early
 * overconfidence this mapping now prices. faintedFraction defaults to 0,
 * so any caller without phase context gets the (conservative) early K.
 *
 * Since the win-prob-space conversion, the sigmoid applies ONCE, at the
 * search leaf (`wpUnits`): every downstream value — cell averages, the
 * equilibrium solve, EvalResult.score, regret — lives in wp-units
 * (2p−1 ∈ [−1, +1]). Averaging wp-units averages probabilities, which is
 * what makes variance genuinely valuable when behind (Jensen) instead of
 * being flattened by score-space means. Display is therefore LINEAR.
 */
export const WINPROB_K = {
  singles: { k0: 2.28, k1: 1.49 },
  doubles: { k0: 2.98, k1: 0.88 },
} as const;

/** P(the RAW score's side wins) — the leaf mapping's core. */
export function winProbability(score: number, doubles = false, faintedFraction = 0): number {
  const { k0, k1 } = doubles ? WINPROB_K.doubles : WINPROB_K.singles;
  return 1 / (1 + Math.exp(-(k0 + k1 * faintedFraction) * score));
}

/** Raw leaf score → win-prob units (2p−1, still in [−1, +1]). */
export const wpUnits = (score: number, doubles = false, faintedFraction = 0): number =>
  2 * winProbability(score, doubles, faintedFraction) - 1;

/** Rounded percent for display — LINEAR: scores are wp-units already. */
export const winPercent = (score: number): number =>
  Math.round(100 * (score + 1) / 2);

/**
 * Display texts: every player-facing value is a win probability. Absolute
 * values read as "52%" (higher is always better for the named side);
 * DIFFERENCES (regret, payoff, swing, luck) read as signed percentage
 * points, "+8%" — one wp-unit spans 50 points.
 */
export const winPctText = (value: number): string => `${winPercent(value)}%`;

export const winDeltaText = (delta: number): string =>
  `${delta < 0 ? '−' : '+'}${Math.round(Math.abs(delta) * 50)}%`;
