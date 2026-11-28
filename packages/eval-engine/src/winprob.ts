import type { StaticRuleset } from './score/weights.ts';

/** The leaf's K at a fainted share f: k0 + k1·f (fainted over total bodies of both sides). */
export interface PhaseK { readonly k0: number; readonly k1: number }

/** Standard leaf K per game type (test/regression/eval-fit.spec.ts); a new K moves the wp-unit tiers and floors. */
export const WINPROB_K = {
  singles: { k0: 2.28, k1: 1.49 },
  doubles: { k0: 2.98, k1: 0.88 },
} as const;

/** Pokémon Champions prices its own scale; Champions singles keeps the singles K. */
export const CHAMPIONS_WINPROB_K = {
  singles: { k0: 2.28, k1: 1.49 },
  doubles: { k0: 1.86, k1: 4.17 },
} as const;

/** VGC doubles has its own entry (Doubles OU's values); VGC has no singles game, so its singles entry is standard. */
export const VGC_WINPROB_K = {
  singles: { k0: 2.28, k1: 1.49 },
  doubles: { k0: 2.98, k1: 0.88 },
} as const;

export const WINPROB_K_OF: Readonly<Record<StaticRuleset, { readonly singles: PhaseK; readonly doubles: PhaseK }>> = {
  standard: WINPROB_K,
  vgc: VGC_WINPROB_K,
  champions: CHAMPIONS_WINPROB_K,
};

export function winprobK(doubles: boolean, ruleset: StaticRuleset = 'standard'): PhaseK {
  const table = WINPROB_K_OF[ruleset];
  return doubles ? table.doubles : table.singles;
}

/** P(the RAW score's side wins), the leaf mapping's core. */
export function winProbability(score: number, doubles = false, faintedFraction = 0, ruleset: StaticRuleset = 'standard'): number {
  const { k0, k1 } = winprobK(doubles, ruleset);
  return 1 / (1 + Math.exp(-(k0 + k1 * faintedFraction) * score));
}

/** Raw leaf score → win-prob units (2p−1, in [−1, +1]); every value downstream of the leaf lives in them. */
export const wpUnits = (score: number, doubles = false, faintedFraction = 0, ruleset: StaticRuleset = 'standard'): number =>
  2 * winProbability(score, doubles, faintedFraction, ruleset) - 1;

/** The display K below DISPLAY_RAMP_START of fainted share; shared by every mode and game type. */
export const DISPLAY_K = 1.85;
const DISPLAY_RAMP_START = 0.25;
const DISPLAY_RAMP_SPAN = 0.25;
const DISPLAY_RAMP = 5;

/** The display K at a fainted share; no share reads as the opening. */
export const displayK = (faintedFraction?: number | null): number =>
  faintedFraction === undefined || faintedFraction === null
    ? DISPLAY_K
    : DISPLAY_K + DISPLAY_RAMP * Math.min(DISPLAY_RAMP_SPAN, Math.max(0, faintedFraction - DISPLAY_RAMP_START));

// Absorbs the one-bit remnant (0.9999999999999999) of ended cells weighted by an equilibrium mix.
const ENDED_EPSILON = 1e-9;

/** Rounded display percent: sigmoid(displayK(share) · score) over wp-unit scores; exact ±1 (ENDED) shows 100/0. */
export const winPercent = (score: number, faintedFraction?: number | null): number => {
  if (score >= 1 - ENDED_EPSILON) return 100;
  if (score <= -1 + ENDED_EPSILON) return 0;
  return Math.round(100 / (1 + Math.exp(-displayK(faintedFraction) * score)));
};

/** Display text of an absolute value through winPercent ("52%"; higher is better for the named side). */
export const winPctText = (value: number, faintedFraction?: number | null): string => `${winPercent(value, faintedFraction)}%`;

/** The points between two printed chances (the better one first), never below 0: what a card, a row or a report prints as a size. */
export const chanceGapPoints = (better: number, played: number, faintedFraction?: number | null): number =>
  Math.max(0, winPercent(better, faintedFraction) - winPercent(played, faintedFraction));

/** The size of a gap between two printed chances ("−11%"). */
export const chanceGapText = (better: number, played: number, faintedFraction?: number | null): string =>
  `−${chanceGapPoints(better, played, faintedFraction)}%`;

/** A DIFFERENCE (regret, payoff, swing, luck) as wp-unit-linear signed points ("+8%"); one wp-unit spans 50 points. */
export const winDeltaText = (delta: number): string =>
  `${delta < 0 ? '−' : '+'}${Math.round(Math.abs(delta) * 50)}%`;
