/**
 * The static evaluation's tuning: the point weights, the raw feature
 * vector one code path shares between scoring and the fitting harness,
 * and the per-gametype feature weights.
 */

/**
 * All tuning in one place. Values are points on an arbitrary scale; the final
 * score is normalized to [-1, +1]. Tactics (KO ranges, speed order) come from
 * the search, not from here — this stays positional.
 */
export const EVAL_WEIGHTS = {
  /** Flat value of a living Pokémon (bodies matter most). */
  alive: 100,
  /** Value of a full health bar, scaled by the current HP fraction. */
  hp: 100,
  /** Multipliers applied to a statused Pokémon's (alive + hp) contribution. */
  status: { brn: 0.85, par: 0.85, psn: 0.9, tox: 0.7, slp: 0.8, frz: 0.75 } as Record<string, number>,
  /**
   * Per boost stage on an active Pokémon (boosts vanish on switch): base
   * points × the diminishing schedule. Offensive stages (atk/spa/spe) carry
   * games; defensive stages read at half weight. Shape follows poke-engine's
   * field-tested curve — the payoff of a setup turn must live in the STATIC
   * eval, deeper search cannot see past its horizon.
   */
  boostStage: { offensive: 12, defensive: 6 },
  /** Cumulative stage multipliers (index = |stage|): +2 is twice +1, the tail flattens. */
  boostSchedule: [0, 1.0, 2.0, 2.5, 3.0, 3.15, 3.3],
  /**
   * Boosts on a statused sweeper sit on a timer — Toxic outruns recovery, so
   * the accumulated stages are worth half (the anti-setup Toxic becomes a
   * rankable line); psn/brn erode slower.
   */
  boostStatusDiscount: { tox: 0.5, psn: 0.8, brn: 0.8 } as Record<string, number>,
  /**
   * Hazards are priced by their VICTIMS, not per layer: each living Pokémon
   * on the suffering side contributes its body weight × the entry-damage
   * fraction the type chart actually assigns it (a 4x-rock Volcarona bleeds
   * 50% per entry, a Lucario 6%) × the expected future entries. A flat layer
   * weight recommended switching out of a rocks turn against rock-weak teams.
   */
  hazardEntries: 0.75,
  /** Per-side clamp on the hazard term (≈ 0.6 mons) so stacking cannot outweigh bodies. */
  hazardCap: 120,
  /** Per active screen (Reflect / Light Screen / Aurora Veil). */
  screen: 5,
  tailwind: 8,
  /** Awarded to the side whose remaining Pokémon are slower while Trick Room is up. */
  trickRoom: 10,
  /** Steepness of the tanh score mapping (a one-mon lead in a 6v6 ≈ ±0.4). */
  scale: 2.5,
  /** Weight of the aggregated 1v1 matchup term (full dominance ≈ 0.6 mons). */
  matchup: 120,
  /**
   * Extra weight on active-vs-active pairs in the matchup term: the mons on
   * the field apply the pressure, the bench only threatens to. Also what
   * makes lead choices visible at depth 1 — every leads cell shares the same
   * teams; only the actives differ.
   */
  activePair: 1.5,
  /**
   * Uncovered-threat term: MAX-based per enemy, unlike the sum-based matchup.
   * An enemy that NO remaining teammate trades favorably against is a
   * wincon-in-waiting — the sum dilutes that into an average, so losing the
   * sole answer (Rhydon vs Salazzle) read as cheap. Weighted per uncovered
   * enemy by its remaining HP.
   */
  coverage: 40,
  /**
   * A Choice item on a status-heavy moveset is a liability, not a boost —
   * the holder can never run its actual game plan again (the anti-setup
   * Trick). Scaled by the holder's status-move fraction: 4 attacks → 0.
   */
  choiceMismatch: 40,
  /**
   * Early-game damp on the matchup FEATURE VALUE: at zero faints the term
   * reads at damp × matchup, scaling linearly to full weight at ≥1/3 of all
   * bodies fainted. 1.0 = off. A phase multiplier folded into the raw value
   * like the other non-independent modifiers — NOT independently fittable
   * (it rescales a feature the fit already prices). Grid-tested 2026-08-09
   * at 1.0/0.75/0.5 through the calibration sweep; see the calibration
   * header for the recorded outcome.
   */
  matchupEarlyDamp: 1.0,
  /**
   * Fraction of a removal option's NET board-state relief that counts:
   * removal costs a tempo turn and can be punished, so the option is worth
   * half its exercise value. See hazardRemovalEquity — the net is
   * move-aware (Defog also destroys the side's OWN hazards on the
   * opponent's board; a net-negative option is never exercised and counts
   * zero). Folded into the raw hazard value — a non-independent modifier,
   * not fittable. Motivating case: draft T14, where switching into the
   * 4x-rock-weak Defog Talonflame read as walking deeper into the hazard
   * cost on the very turn that sets up the removal.
   */
  hazardRemovalDiscount: 0.5,
  /**
   * Alive-share multiplier for a STRANDED bench mon — one whose HP cannot
   * survive re-entering through its own side's hazards while the side has
   * no living removal carrier. Its hp share prices at effHp (0 by
   * definition of stranded); the remaining alive share is fodder/absorber
   * value. Hand weight, calibration-gated 2026-08-15 (spec: horizon
   * family ④; the depth-2 switch that strands a piece banked a phantom
   * body — 653785 t19, 655336 t23/t24).
   */
  strandedAlive: 0.5,
} as const;

/**
 * Raw, unweighted feature values (p1-positive differences). The score is the
 * weighted sum through tanh — ONE code path shared by scoring and the WP 7
 * fitting harness, so fitted weights and runtime scores cannot diverge.
 * Multiplicative modifiers are NOT independent features: status and item
 * multipliers fold into `bodies`, the status discount into `boosts`, the
 * offensive/defensive split (2:1) and the cap/entries coupling into their
 * raw values. Only the top-level FEATURE_WEIGHTS are fittable.
 */
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
  /**
   * Win-condition value of standing boosts, split by HOW the sweep would
   * actually play out. Per side, over living mons with a positive offensive
   * stage, each pair the boost FLIPS (beats 1v1 boosted, loses unboosted)
   * contributes 1/enemies × hpFraction into exactly ONE cell:
   * fast = the sweeper acts first (movesFirst: priority rule, effective
   * speed, Trick Room), ko = the boosted best-move fraction covers the
   * target's current HP. The four cells sum to the old v1 flip value; the
   * fit prices them separately (no guessed factors). Weights 0 keep them
   * runtime-inert until a fit adopts them (round 9 design doc).
   */
  sweepFastKo: number;
  sweepFastChip: number;
  sweepSlowKo: number;
  sweepSlowChip: number;
}

export const FEATURE_WEIGHTS: Record<keyof EvalFeatures, number> = {
  bodies: EVAL_WEIGHTS.alive + EVAL_WEIGHTS.hp,
  boosts: EVAL_WEIGHTS.boostStage.offensive,
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
};

/**
 * Doubles overrides, corpus-fitted 2026-08-08 (590 doubles/VGC games,
 * cluster-bootstrap significant): speed control and screens carry far more
 * win probability in doubles than the singles hand weights say — tailwind
 * 68±25 vs 8, Trick Room 87±27 vs 10, screens 103±40 vs 5, boosts 27±7 vs
 * 12. The direction matches doubles domain knowledge (speed control decides
 * VGC games); confounding (winning teams get their setup up) likely inflates
 * the magnitudes, so adoption is gated on the calibration buckets like every
 * other weight change. Features consistent with the hand weights (hazards,
 * matchup, coverage) keep them.
 */
export const DOUBLES_FEATURE_WEIGHTS: Record<keyof EvalFeatures, number> = {
  ...FEATURE_WEIGHTS,
  boosts: 27,
  tailwind: 68,
  trickRoom: 87,
};

export const featureWeights = (doubles: boolean): Record<keyof EvalFeatures, number> =>
  (doubles ? DOUBLES_FEATURE_WEIGHTS : FEATURE_WEIGHTS);
