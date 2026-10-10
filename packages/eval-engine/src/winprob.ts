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
 * RE-FIT 2026-09-18 (round 47, the first capture since the forme-marker
 * merge, 12,821 positions of 2,111 games): NOTHING ADOPTED. fitPhaseK stops
 * after 500 fixed gradient steps, short of the maximum: it reports singles
 * 2.51/1.18 and doubles 2.58/1.15 where the likelihood peaks at 1.86/3.73
 * and 1.99/3.67, and the pins below are such intermediate states too. On
 * the bank none of the three separates from the pins (paired Brier with a
 * bootstrap over games: 500-step singles K +2 bp [−4, +9], the maxima −2
 * bp [−19, +14], early better, hq mid and doubles late worse). See the
 * ledger (RE-FIT VERDICT 2026-09-18).
 * ROUND 48 (2026-09-19): the fitter runs to its maximum now, and the pins
 * STAY. A capped singles form (1.548 + 6.007·min(ff, 0.35)) wins 4 bp out
 * of sample on the fit corpus and shows no harm on the bank, but it stamps
 * a blunder on the expert golden's t23 sack: the verdict tiers and the sack
 * and prover floors are measured in wp-units, so a new K moves each of
 * them. No K adoption before those thresholds are decoupled or re-set with
 * it (ledger K FIT CONVERGED 2026-09-19, NextSteps T52; doubles T53).
 * ROUND 67 (T52): doubles move to that converged maximum, 1.987 + 3.666·ff,
 * read on the bank plus the doubles holdout with both tables; the thresholds
 * in wp-units stay where they are (wave 2, decision 33).
 *
 * Since the win-prob-space conversion, the LEAF sigmoid applies once, at
 * the search leaf (`wpUnits`): every downstream value — cell averages, the
 * equilibrium solve, EvalResult.score, regret — lives in wp-units
 * (2p−1 ∈ [−1, +1]). Averaging wp-units averages probabilities, which is
 * what makes variance genuinely valuable when behind (Jensen) instead of
 * being flattened by score-space means.
 *
 * DISPLAY is a SECOND calibration stage (2026-08-11): averaging plus
 * equilibrium selection re-inflates the aggregated ROOT score, so the
 * empirically honest displayed probability is sigmoid(DISPLAY_K · score),
 * not the linear (score+1)/2. Both stages are measured, not accidental —
 * see DISPLAY_K below. DIFFERENCES (regret, swings, verdict bands) stay in
 * wp-units.
 */
import type { StaticRuleset } from './score/weights.ts';

export const WINPROB_K = {
  singles: { k0: 2.28, k1: 1.49 },
  doubles: { k0: 1.987, k1: 3.666 },
} as const;

/**
 * Round 67 (T138): Pokémon Champions prices its own scale. Fitted on its own
 * corpus games in the app's build on the Champions mod with the round-67
 * tables, the holdout and unrated ladder games left out (regression/
 * fit-families.ts phaseKReports): singles 1.64 + 4.41·ff (1,956 positions of
 * 285 sets; K at a third fainted 3.11 [2.50, 3.93]), doubles 1.86 + 4.17·ff
 * (2,510 positions of 386 sets; 3.25 [2.83, 3.65]). The Scarlet/Violet K read
 * the early Champions game too confidently and the late one too timidly. The
 * thresholds in wp-units stay where they are (wave 2, decision 33).
 */
export const CHAMPIONS_WINPROB_K = {
  singles: { k0: 1.64, k1: 4.41 },
  doubles: { k0: 1.86, k1: 4.17 },
} as const;

/** The leaf's phase K of a game type under a rule set: Champions its own, every other rule set its game type's. */
export function winprobK(doubles: boolean, ruleset: StaticRuleset = 'standard'): { readonly k0: number; readonly k1: number } {
  const table = ruleset === 'champions' ? CHAMPIONS_WINPROB_K : WINPROB_K;
  return doubles ? table.doubles : table.singles;
}

/** P(the RAW score's side wins) — the leaf mapping's core. */
export function winProbability(score: number, doubles = false, faintedFraction = 0, ruleset: StaticRuleset = 'standard'): number {
  const { k0, k1 } = winprobK(doubles, ruleset);
  return 1 / (1 + Math.exp(-(k0 + k1 * faintedFraction) * score));
}

/** Raw leaf score → win-prob units (2p−1, still in [−1, +1]), under the K of the rule set. */
export const wpUnits = (score: number, doubles = false, faintedFraction = 0, ruleset: StaticRuleset = 'standard'): number =>
  2 * winProbability(score, doubles, faintedFraction, ruleset) - 1;

/**
 * Display calibration for aggregated root scores. Fitted 2026-08-11 on a
 * 1/20 fit-corpus slice (629 joined d1/mcts search-score pairs: d1 1.75 ·
 * mcts 1.81 · auto-routed 1.87 — insensitive within the range) and graded
 * OUT-OF-SAMPLE on the 826-position calibration grand bed: brier 0.2275
 * (linear) → 0.2207, late 0.2180 → 0.1972. Per-mode (+0.0002),
 * phase-linear (k1 fits negative), and per-gametype (doubles overfits,
 * 0.2167 vs 0.2068) variants all tie or lose OOS — one shared constant is
 * the honest map.
 */
export const DISPLAY_K = 1.85;

/**
 * Rounded percent for display: sigmoid(DISPLAY_K · score) over wp-unit
 * scores. Exact ±1 is an ENDED evaluation (only finished games reach it —
 * the leaf sigmoid saturates near but never at ±1), and a finished game
 * displays finished: literal 100/0. A row of ended cells weighted by an
 * equilibrium mix keeps a one-bit rounding remnant (0.9999999999999999),
 * which is still the finished game; ENDED_EPSILON absorbs it, far below
 * anything an unfinished evaluation reaches.
 */
const ENDED_EPSILON = 1e-9;

export const winPercent = (score: number): number => {
  if (score >= 1 - ENDED_EPSILON) return 100;
  if (score <= -1 + ENDED_EPSILON) return 0;
  return Math.round(100 / (1 + Math.exp(-DISPLAY_K * score)));
};

/**
 * Display texts: every player-facing value is a win probability. Absolute
 * values run through the calibrated winPercent ("52%", higher is always
 * better for the named side); DIFFERENCES (regret, payoff, swing, luck)
 * stay wp-unit-linear and read as signed percentage points, "+8%" — one
 * wp-unit spans 50 points.
 */
export const winPctText = (value: number): string => `${winPercent(value)}%`;

export const winDeltaText = (delta: number): string =>
  `${delta < 0 ? '−' : '+'}${Math.round(Math.abs(delta) * 50)}%`;
