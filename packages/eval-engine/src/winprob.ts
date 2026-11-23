// Score to win-probability mapping: the leaf sigmoid with a phase-aware K, and the display calibration of aggregated root scores.
import type { StaticRuleset } from './score/weights.ts';

/** The leaf's K at a fainted share f: k0 + k1·f (fainted over total bodies of both sides; the early game earns less confidence per point than the endgame). */
export interface PhaseK { readonly k0: number; readonly k1: number }

/** Standard leaf K per game type (fits: test/regression/eval-fit.spec.ts); the verdict tiers and the sack and prover floors are in wp-units, so a new K moves them. */
export const WINPROB_K = {
  singles: { k0: 2.28, k1: 1.49 },
  doubles: { k0: 2.98, k1: 0.88 },
} as const;

/**
 * Pokémon Champions prices its own scale: the Scarlet/Violet doubles K read the early Champions game too confidently. Champions
 * singles keeps the singles K (its own fit read the mid game worse).
 */
export const CHAMPIONS_WINPROB_K = {
  singles: { k0: 2.28, k1: 1.49 },
  doubles: { k0: 1.86, k1: 4.17 },
} as const;

/**
 * VGC doubles has an entry of its own that holds Doubles OU's values; VGC has no singles game, so its singles entry is the standard
 * one. Each of the five families (standard and Champions singles, Doubles OU, VGC, Champions VGC) is fitted and pinned on its own.
 */
export const VGC_WINPROB_K = {
  singles: { k0: 2.28, k1: 1.49 },
  doubles: { k0: 2.98, k1: 0.88 },
} as const;

/** One K table per rule set (test/regression/fit-families.ts reads them by rule set, scripts/k-stamp.mjs stamps them). */
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

/** Raw leaf score → win-prob units (2p−1, in [−1, +1]), under the K of the rule set; every value downstream of the leaf lives in them. */
export const wpUnits = (score: number, doubles = false, faintedFraction = 0, ruleset: StaticRuleset = 'standard'): number =>
  2 * winProbability(score, doubles, faintedFraction, ruleset) - 1;

/** The display K for the opening of the game (a fainted share under DISPLAY_RAMP_START); one shared constant, not one per mode or game type. */
export const DISPLAY_K = 1.85;
// From a fainted share of DISPLAY_RAMP_START the K rises by DISPLAY_RAMP per unit of share over DISPLAY_RAMP_SPAN
// (1.85 to 3.10 at 0.5): late positions are proven, not guessed.
const DISPLAY_RAMP_START = 0.25;
const DISPLAY_RAMP_SPAN = 0.25;
const DISPLAY_RAMP = 5;

/** The display K at a fainted share (the auto mode's phase measure); no share reads as the opening, DISPLAY_K. */
export const displayK = (faintedFraction?: number | null): number =>
  faintedFraction === undefined || faintedFraction === null
    ? DISPLAY_K
    : DISPLAY_K + DISPLAY_RAMP * Math.min(DISPLAY_RAMP_SPAN, Math.max(0, faintedFraction - DISPLAY_RAMP_START));

// ENDED_EPSILON absorbs the one-bit remnant (0.9999999999999999) of ended cells weighted by an equilibrium mix;
// far below anything an unfinished evaluation reaches.
const ENDED_EPSILON = 1e-9;

/** Rounded percent for display: sigmoid(displayK(share) · score), not the linear (score+1)/2, over wp-unit scores; exact ±1 (an ENDED evaluation) displays literal 100/0. */
export const winPercent = (score: number, faintedFraction?: number | null): number => {
  if (score >= 1 - ENDED_EPSILON) return 100;
  if (score <= -1 + ENDED_EPSILON) return 0;
  return Math.round(100 / (1 + Math.exp(-displayK(faintedFraction) * score)));
};

/** Display text of an absolute value through winPercent ("52%"; higher is better for the named side). */
export const winPctText = (value: number, faintedFraction?: number | null): string => `${winPercent(value, faintedFraction)}%`;

/** Display text of a DIFFERENCE (regret, payoff, swing, luck): wp-unit-linear signed percentage points ("+8%"); one wp-unit spans 50 points. */
export const winDeltaText = (delta: number): string =>
  `${delta < 0 ? '−' : '+'}${Math.round(Math.abs(delta) * 50)}%`;
