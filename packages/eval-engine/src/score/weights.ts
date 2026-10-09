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
   * eval, deeper search cannot see past its horizon. The 18 Sep re-fit
   * implies 39 ± 6 in singles and the paired bank agrees (hq singles
   * −4/−27/−5 bp), but the verdicts do not: at 39 the stall game 573756 goes
   * from 14 inaccuracies and no mistake to 40 and 7, every one of them "set
   * up instead of stalling on". A standing stage is priced without asking
   * whether it bites the wall in front of it; the weight stays until it does.
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
   * stage, each pair the boost FLIPS (beats 1v1 boosted, loses unboosted;
   * since round 64 "unboosted" reads the mon on no stages at all)
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
 * Doubles OU and every doubles format outside VGC and Champions, fitted
 * 2026-10-09 (round 65, T127) at the fixed doubles K on the corpus measured
 * like the app (the app's team build, the bank's reconstruction): 3,951
 * positions of 679 sets of the Scarlet/Violet doubles without the holdout
 * (739 Doubles OU games, 28 VGC games), folds and bootstrap clustered by
 * set. Fitted with their 90 % band: bodies 180 [159, 201], hazards 0.51
 * [0.13, 0.92], screens 88 [44, 144], matchup 118 [42, 205], coverage 91
 * [34, 171], Trick Room 58 [29, 90]. Held: the boost weights, tailwind (the
 * first pass flagged it) and choice mismatch. Out of fold it beats the hand
 * table in 17 of 20 seeds (log-loss −14.5 bp, Brier −7 bp), short of the
 * pre-registered 20. On the holdout's 369 Doubles OU games the search reads
 * −36 bp [−62, −10] (own K per phase −28 [−51, −6]), on the bank's 36
 * Doubles OU games +144 [+24, +279], nearly all of it the screens weight:
 * in the bank's games with screens up the screens side lost 9 of 14, in the
 * holdout's it won 48 of 83. Bank and holdout together read −11 [−40, +18].
 * Adopted at the round-65 gate ("2b": Doubles OU takes the fit, VGC keeps
 * the hand table).
 */
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
};

/**
 * VGC outside Champions (doubles; bring six, pick four, level 50): the hand
 * doubles table, corpus-fitted 2026-08-08 (590 doubles and VGC games,
 * cluster-bootstrap significant): speed control carries far more win
 * probability in doubles than the singles hand weights say (tailwind 68±25
 * against 8, Trick Room 87±27 against 10, boosts 27±7 against 12); the
 * other weights are the singles hand weights. Round 65 keeps it for VGC:
 * the corpus holds 50 VGC games against 1,108 Doubles OU, and on the 31 VGC
 * games of bank and holdout the Doubles OU fit read +85 bp [−10, +181].
 * Written out in full, so a refit of Doubles OU never moves it.
 */
export const VGC_DOUBLES_FEATURE_WEIGHTS: Record<keyof EvalFeatures, number> = {
  bodies: 200,
  boosts: 27,
  hazards: 0.75,
  screens: 5,
  tailwind: 68,
  trickRoom: 87,
  matchup: 120,
  coverage: 40,
  choiceMismatch: 40,
  sweepFastKo: 0,
  sweepFastChip: 0,
  sweepSlowKo: 0,
  sweepSlowChip: 0,
};

/**
 * The rule set a battle runs under (round 65). The simulator knows no
 * Pokémon Champions format (its doubles reconstructions run as Doubles OU,
 * its singles as a custom game), so the host names the rule set from the
 * replay's format (replayRuleset in replay-core) and hands it to the search
 * (EvalSettings.ruleset); the static weighs the features with the table of
 * its rule set and game type. Champions OU (singles) and Champions VGC
 * (doubles) are their own games with their own fits: on the round-65
 * corpus their fitted weights part from the Scarlet/Violet games'
 * (Champions OU bodies 121 and matchup 210 against the singles table's 200
 * and 120). VGC outside Champions parts from Doubles OU (bring six, pick
 * four, level 50) and keeps the hand doubles table until it has data of
 * its own; a VGC singles game reads the singles table.
 */
export type StaticRuleset = 'standard' | 'vgc' | 'champions';

/**
 * Champions OU (singles), fitted 2026-10-09 (round 65, T127) at the fixed
 * singles K on its own games: 1,971 positions of 285 sets (450 ladder games
 * rated 1366 to 1665, two thirds of their sets; the third is the holdout),
 * the corpus measured like the app (the app's team build, the bank's
 * reconstruction), folds and bootstrap clustered by set. Out of fold it
 * beats the singles table in 20 of 20 seeds (log-loss −102 bp, Brier
 * −50 bp); on the holdout's 149 games the static reads −85 bp [−164, −5]
 * and the search −23 bp [−97, +49] (own K per phase −8, early −83
 * [−172, 0], late +87 under the fixed K and +24 under its own). Fitted with
 * their 90 % band: bodies 121 [87, 157], hazards 1.13 [0.6, 1.7], matchup
 * 210 [82, 363]. Held: coverage (the first pass flipped its sign), the
 * boost, Trick Room and choice-mismatch weights (variant E's holds);
 * screens and tailwind lack support in Champions OU. Written out in full,
 * so an edit of the singles table never moves a held Champions weight.
 */
export const CHAMPIONS_FEATURE_WEIGHTS: Record<keyof EvalFeatures, number> = {
  bodies: 121,
  boosts: 12,
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
};

/**
 * Champions VGC (doubles): the hand doubles table (as VGC); its own fit in
 * round 65 beat it in 7 of 20 seeds. Written out in full.
 */
export const CHAMPIONS_DOUBLES_FEATURE_WEIGHTS: Record<keyof EvalFeatures, number> = {
  bodies: 200,
  boosts: 27,
  hazards: 0.75,
  screens: 5,
  tailwind: 68,
  trickRoom: 87,
  matchup: 120,
  coverage: 40,
  choiceMismatch: 40,
  sweepFastKo: 0,
  sweepFastChip: 0,
  sweepSlowKo: 0,
  sweepSlowChip: 0,
};

/** The weight table of a game type under a rule set. */
export function featureWeights(doubles: boolean, ruleset: StaticRuleset = 'standard'): Record<keyof EvalFeatures, number> {
  if (ruleset === 'champions') return doubles ? CHAMPIONS_DOUBLES_FEATURE_WEIGHTS : CHAMPIONS_FEATURE_WEIGHTS;
  if (!doubles) return FEATURE_WEIGHTS;
  return ruleset === 'vgc' ? VGC_DOUBLES_FEATURE_WEIGHTS : DOUBLES_FEATURE_WEIGHTS;
}
