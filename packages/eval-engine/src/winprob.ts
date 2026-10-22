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
 * ROUND 67 (T52): that converged doubles maximum, 1.987 + 3.666·ff, did not
 * pass on the bank plus the doubles holdout: the bank gain (fixed K −36 bp)
 * did not carry to the holdout, and with own K per phase the doubles row read
 * +5 [−2, +12] with harm in the luck-adjusted rows (+8 [+1, +16]); the pins
 * stay.
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

/** The leaf's K at a fainted share f: k0 + k1·f. */
export interface PhaseK { readonly k0: number; readonly k1: number }

/**
 * Round 74 (T163): the table of the standard rule set (standard singles and Doubles OU) is a CANDIDATE until the bank
 * and the holdouts decide (D4). Fitted on the search's own root values (the full fit corpus, captured with search in
 * CI at d6e9259; regression/fit-families.ts rootScaleReports): the scale c0 + c1·ff of the old K, K' = K·c.
 * Singles: 4,309 positions of 1,363 sets, c = 1.23 − 0.33·ff, K at 0, a third and two thirds fainted 2.80 [2.37, 3.31],
 * 3.10 [2.87, 3.39], 3.29 [2.63, 4.16] against today's 2.28 + 1.49·ff (2.28, 2.78, 3.27); the band of c0 (1.04 to
 * 1.45) leaves 1. Doubles: 2,131 positions of 651 sets, c = 0.99 + 0.07·ff, K at the same shares 2.96 [2.48, 3.51],
 * 3.32 [3.02, 3.67], 3.70 [2.97, 4.52] against 2.98, 3.27, 3.57; the band of c includes 1 (c0 0.83 to 1.18).
 * The values before: singles 2.28 + 1.49·ff, doubles 2.98 + 0.88·ff (the 1,100-game fit of 2026-08-09).
 */
export const WINPROB_K = {
  singles: { k0: 2.81, k1: 0.8 },
  doubles: { k0: 2.95, k1: 1.11 },
} as const;

/**
 * Round 67 (T138): Pokémon Champions doubles prices its own scale. Fitted on
 * its own corpus games in the app's build on the Champions mod with the
 * round-67 tables, the holdout and unrated ladder games left out (regression/
 * fit-families.ts phaseKReports): 1.86 + 4.17·ff (2,510 positions of 386
 * sets; K at a third fainted 3.25 [2.83, 3.65]). On the Champions VGC holdout
 * with search it reads −16 bp [−27, −5] with the base's K (early −40) and
 * level with own K per phase: the Scarlet/Violet doubles K read the early
 * Champions game too confidently. Champions singles keeps the singles K: its
 * fit, 1.64 + 4.41·ff (1,956 positions of 285 sets), read the Champions OU
 * holdout −28 [−56, +1] with the base's K but its mid game worse in both
 * tables (+35 [+7, +65], own K +26 [+3, +47]). The thresholds in wp-units
 * stay where they are (wave 2, decision 33).
 */
/**
 * Round 74 (T163), candidates until the bank and the holdouts decide (D4), fitted on the search's own root values of
 * the Champions corpus (rootScaleReports). Champions singles (Champions OU): 900 positions of 285 sets, c = 0.91 +
 * 0.59·ff, K at 0, a third and two thirds fainted 2.08 [1.22, 3.10], 3.08 [2.47, 3.85], 4.28 [3.21, 5.71]; the band of
 * c includes 1 (c0 0.54 to 1.36). Champions doubles (Champions VGC): 1,486 positions of 386 sets, c = 0.95 − 0.22·ff,
 * K 1.77 [1.43, 2.19], 2.86 [2.54, 3.26], 3.75 [2.67, 4.94]; the band of c includes 1 (c0 0.77 to 1.18). The values
 * before: singles 2.28 + 1.49·ff (the standard singles K), doubles 1.86 + 4.17·ff (round 67).
 */
export const CHAMPIONS_WINPROB_K = {
  singles: { k0: 2.05, k1: 3.22 },
  doubles: { k0: 1.8, k1: 3.07 },
} as const;

/**
 * Round 74 (T163): VGC doubles resolves its own entry, so a fit sets it without touching Doubles OU (until now both
 * shared 2.98 + 0.88·ff). Champions singles likewise has an entry of its own (it referenced the standard singles
 * before), so each of the five families (standard and Champions singles, Doubles OU, VGC, Champions VGC) is fitted
 * and pinned on its own. VGC doubles is a CANDIDATE until the bank and the holdouts decide (D4): fitted on the
 * search's own root values (rootScaleReports), 2,234 positions of 711 sets, c = 0.70 + 0.15·ff, K at 0, a third and
 * two thirds fainted 2.10 [1.67, 2.45], 2.46 [2.21, 2.81], 2.86 [2.28, 3.66]; the band of c0 (0.56 to 0.82) leaves 1,
 * the one family whose search reads clearly too confident. VGC has no singles game: its singles entry stays the
 * standard one of before (2.28 + 1.49·ff) and no game reads it.
 */
export const VGC_WINPROB_K = {
  singles: { k0: 2.28, k1: 1.49 },
  doubles: { k0: 2.09, k1: 1.13 },
} as const;

/** One K table per rule set (regression/fit-families.ts reads them by rule set, scripts/k-stamp.mjs stamps them). */
export const WINPROB_K_OF: Readonly<Record<StaticRuleset, { readonly singles: PhaseK; readonly doubles: PhaseK }>> = {
  standard: WINPROB_K,
  vgc: VGC_WINPROB_K,
  champions: CHAMPIONS_WINPROB_K,
};

/** The leaf's phase K of a game type under a rule set: each rule set its own table, each game type its own entry. */
export function winprobK(doubles: boolean, ruleset: StaticRuleset = 'standard'): PhaseK {
  const table = WINPROB_K_OF[ruleset];
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
 *
 * Round 69 (T51): the constant stays the value for the opening of the game.
 * From a fainted share of DISPLAY_RAMP_START the K rises by DISPLAY_RAMP per
 * unit of share over DISPLAY_RAMP_SPAN (1.85 to 3.10 at a share of 0.5):
 * late positions are proven, not guessed, and the constant showed them too
 * timid (late 76 % shown, 88 to 91 % won). Probe P1 (displayk-offline.mjs, 4931
 * rows of the bank and the four holdouts, 1527 games, leave-one-game-out and
 * both train/grade swaps): pooled -18 bp [-25, -10], late -64 bp, Doubles late
 * -66 bp, early +0.6 bp (share under 0.25 reads as before), mid +10 bp
 * (band includes 0). One shared form: a K per game type or for VGC did not
 * beat it out of sample.
 */
export const DISPLAY_K = 1.85;
const DISPLAY_RAMP_START = 0.25;
const DISPLAY_RAMP_SPAN = 0.25;
const DISPLAY_RAMP = 5;

/** The display K at a fainted share (the auto mode's phase measure); no share reads as the opening, DISPLAY_K. */
export const displayK = (faintedFraction?: number | null): number =>
  faintedFraction === undefined || faintedFraction === null
    ? DISPLAY_K
    : DISPLAY_K + DISPLAY_RAMP * Math.min(DISPLAY_RAMP_SPAN, Math.max(0, faintedFraction - DISPLAY_RAMP_START));

/**
 * Rounded percent for display: sigmoid(displayK(share) · score) over wp-unit
 * scores. The graph and every number read this one function with the turn's
 * fainted share (round 69, T51, decision 22). Exact ±1 is an ENDED evaluation (only finished games reach it —
 * the leaf sigmoid saturates near but never at ±1), and a finished game
 * displays finished: literal 100/0. A row of ended cells weighted by an
 * equilibrium mix keeps a one-bit rounding remnant (0.9999999999999999),
 * which is still the finished game; ENDED_EPSILON absorbs it, far below
 * anything an unfinished evaluation reaches.
 */
const ENDED_EPSILON = 1e-9;

export const winPercent = (score: number, faintedFraction?: number | null): number => {
  if (score >= 1 - ENDED_EPSILON) return 100;
  if (score <= -1 + ENDED_EPSILON) return 0;
  return Math.round(100 / (1 + Math.exp(-displayK(faintedFraction) * score)));
};

/**
 * Display texts: every player-facing value is a win probability. Absolute
 * values run through the calibrated winPercent ("52%", higher is always
 * better for the named side); DIFFERENCES (regret, payoff, swing, luck)
 * stay wp-unit-linear and read as signed percentage points, "+8%" — one
 * wp-unit spans 50 points.
 */
export const winPctText = (value: number, faintedFraction?: number | null): string => `${winPercent(value, faintedFraction)}%`;

export const winDeltaText = (delta: number): string =>
  `${delta < 0 ? '−' : '+'}${Math.round(Math.abs(delta) * 50)}%`;
