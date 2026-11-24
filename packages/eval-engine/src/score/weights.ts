
/** All tuning in one place: points on an arbitrary scale, the final score normalized to [-1, +1]. */
export const EVAL_WEIGHTS = {
  alive: 100,
  hp: 100,
  status: { brn: 0.85, par: 0.85, psn: 0.9, tox: 0.7, slp: 0.8, frz: 0.75 } as Record<string, number>,
  /** Points per stage, offensive 2:1 over defensive; singles prices stages through boostsBiting, `boosts` reads 0. */
  boostStage: { offensive: 12, defensive: 6 },
  /** Cumulative stage multipliers, indexed by |stage|. */
  boostSchedule: [0, 1.0, 2.0, 2.5, 3.0, 3.15, 3.3],
  boostStatusDiscount: { tox: 0.5, psn: 0.8, brn: 0.8 } as Record<string, number>,
  hazardEntries: 0.75,
  hazardCap: 120,
  screen: 5,
  tailwind: 8,
  trickRoom: 10,
  scale: 2.5,
  matchup: 120,
  activePair: 1.5,
  coverage: 40,
  choiceMismatch: 40,
  /** 1.0 = off. */
  matchupEarlyDamp: 1.0,
  hazardRemovalDiscount: 0.5,
  strandedAlive: 0.5,
} as const;

// Only the top-level FEATURE_WEIGHTS are fittable; multiplicative modifiers are folded into their raw values.
/** Raw, unweighted feature values, p1-positive differences; the score is their weighted sum through tanh. */
export interface EvalFeatures {
  bodies: number;
  boosts: number;
  hazards: number;
  screens: number;
  tailwind: number;
  trickRoom: number;
  matchup: number;
  coverage: number;
  choiceMismatch: number;
  /** Weight 0 in every table. */
  sweepFastKo: number;
  sweepFastChip: number;
  sweepSlowKo: number;
  sweepSlowChip: number;
  /** Doubles only (0 in singles), p1-positive differences, weight 0 in every table (score/field-pair.ts). */
  pairFocus: number;
  pairRedirect: number;
  /** `boosts` damped by the foes it bites (score/boost-bite.ts); same sign and scale, replaces `boosts` where set. */
  boostsBiting: number;
  /** What the status multiplier of `bodies` gets wrong for an ability that changes the cost (status-factor.ts). */
  statusFix: number;
}

/** The hand singles table; `boostsBiting` carries the stage weight and `statusFix` the weight of `bodies`. */
export const FEATURE_WEIGHTS: Record<keyof EvalFeatures, number> = {
  bodies: EVAL_WEIGHTS.alive + EVAL_WEIGHTS.hp,
  boosts: 0,
  hazards: EVAL_WEIGHTS.hazardEntries,
  screens: EVAL_WEIGHTS.screen,
  tailwind: EVAL_WEIGHTS.tailwind,
  trickRoom: EVAL_WEIGHTS.trickRoom,
  matchup: EVAL_WEIGHTS.matchup,
  coverage: EVAL_WEIGHTS.coverage,
  choiceMismatch: EVAL_WEIGHTS.choiceMismatch,
  sweepFastKo: 0,
  sweepFastChip: 0,
  sweepSlowKo: 0,
  sweepSlowChip: 0,
  pairFocus: 0,
  pairRedirect: 0,
  boostsBiting: 95,
  statusFix: EVAL_WEIGHTS.alive + EVAL_WEIGHTS.hp,
};

/** Doubles OU and every doubles format outside VGC and Champions, fitted on the Scarlet/Violet doubles corpus. */
export const DOUBLES_FEATURE_WEIGHTS: Record<keyof EvalFeatures, number> = {
  bodies: 180,
  boosts: 27,
  hazards: 0.51,
  screens: 88,
  tailwind: 68,
  trickRoom: 58,
  matchup: 118,
  coverage: 91,
  choiceMismatch: 40,
  sweepFastKo: 0,
  sweepFastChip: 0,
  sweepSlowKo: 0,
  sweepSlowChip: 0,
  pairFocus: 0,
  pairRedirect: 0,
  boostsBiting: 0,
  statusFix: 0,
};

// Tailwind, coverage and pairFocus stay 0: the matchup term already prices the first two, pairFocus is a 0/1 gate.
/** VGC outside Champions: the Scarlet/Violet doubles values, with bodies, screens, matchup, Trick Room fit on VGC. */
export const VGC_DOUBLES_FEATURE_WEIGHTS: Record<keyof EvalFeatures, number> = {
  bodies: 177,
  boosts: 0,
  hazards: 0.75,
  screens: 48,
  tailwind: 0,
  trickRoom: 54,
  matchup: 169,
  coverage: 0,
  choiceMismatch: 40,
  sweepFastKo: 0,
  sweepFastChip: 0,
  sweepSlowKo: 0,
  sweepSlowChip: 0,
  pairFocus: 0,
  pairRedirect: 0,
  boostsBiting: 16,
  statusFix: 0,
};

/** The rule set a battle runs under, named by the host from the replay's format (the simulator knows no Champions). */
export type StaticRuleset = 'standard' | 'vgc' | 'champions';

/** Champions OU (singles), fitted on its own games; `boostsBiting` replaces `boosts`. */
export const CHAMPIONS_FEATURE_WEIGHTS: Record<keyof EvalFeatures, number> = {
  bodies: 121,
  boosts: 0,
  hazards: 1.13,
  screens: 5,
  tailwind: 8,
  trickRoom: 10,
  matchup: 210,
  coverage: 40,
  choiceMismatch: 40,
  sweepFastKo: 0,
  sweepFastChip: 0,
  sweepSlowKo: 0,
  sweepSlowChip: 0,
  pairFocus: 0,
  pairRedirect: 0,
  boostsBiting: 102,
  statusFix: 0,
};

/** Champions doubles, read by every Champions doubles format; fitted on Champions VGC games. */
export const CHAMPIONS_DOUBLES_FEATURE_WEIGHTS: Record<keyof EvalFeatures, number> = {
  bodies: 196,
  boosts: 0,
  hazards: 0.75,
  screens: 83,
  tailwind: 68,
  trickRoom: 87,
  matchup: 96,
  coverage: 40,
  choiceMismatch: 40,
  sweepFastKo: 0,
  sweepFastChip: 0,
  sweepSlowKo: 0,
  sweepSlowChip: 0,
  pairFocus: 0,
  pairRedirect: 0,
  boostsBiting: 61,
  statusFix: 0,
};

/** The weight table of a game type under a rule set; a VGC singles game reads the singles table. */
export function featureWeights(doubles: boolean, ruleset: StaticRuleset = 'standard'): Record<keyof EvalFeatures, number> {
  if (ruleset === 'champions') return doubles ? CHAMPIONS_DOUBLES_FEATURE_WEIGHTS : CHAMPIONS_FEATURE_WEIGHTS;
  if (!doubles) return FEATURE_WEIGHTS;
  return ruleset === 'vgc' ? VGC_DOUBLES_FEATURE_WEIGHTS : DOUBLES_FEATURE_WEIGHTS;
}
