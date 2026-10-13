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
   * Round 69 (S8, T49): it does. The singles table prices the stages through
   * boostsBiting (95) and `boosts` reads 0 there; these 12 and 6 stay the
   * hand reference of the 2:1 split that both columns share.
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
  /**
   * Round 69 (T42, decision 15): the field pair of a doubles board, p1-positive
   * differences, 0 in singles, weight 0 until a fit prices them. pairFocus: a
   * foe on the field that neither of the side's two actives KOs alone and both
   * KO together, valued by the second attacker's marginal share of the foe's
   * HP, over the foes on the field. pairRedirect: a living Follow Me or Rage
   * Powder user next to a partner with damage, valued by the partner's best
   * share of a foe's HP it covers, at the redirector's HP (score/field-pair.ts).
   */
  pairFocus: number;
  pairRedirect: number;
  /**
   * Round 69 (T49, decision 16): `boosts` with every standing stage damped by
   * the share of living foes it bites (score/boost-bite.ts): a foe bites back
   * the stage when it plays Unaware (asked from the simulator's ModifyBoost),
   * clicks a move that takes the stages away (Haze, Clear Smog, Roar and the
   * like, played in the simulator), or when the stage buys no KO, no slower
   * foe KO and no move order within a few turns of the race. Same sign and
   * scale as `boosts`, p1-positive difference; weight 0 until a fit prices it,
   * and then it replaces `boosts` (the damping lives in the feature).
   */
  boostsBiting: number;
  /**
   * Round 69 (T102, decision 17): what the status multiplier of `bodies` gets
   * wrong for a body whose ability changes what the status costs. Per living
   * body, (the right multiplier minus the applied one) times the body's share
   * before the status multiplier, p1-positive difference. The right multiplier
   * is played in the simulator (score/status-factor.ts): 1 where the ability
   * turns the status into a gain (Poison Heal, Guts, Quick Feet, Marvel Scale,
   * Toxic Boost, Flare Boost), part of the way to 1 where it cancels only some
   * of the cost (Magic Guard under burn: the chip is gone, the halved Attack
   * stays). 0 for every body without such an ability. Weight 0 until a fit
   * prices it; at the weight of `bodies` it folds the right multiplier in.
   */
  statusFix: number;
}

/**
 * The hand singles table. Round 69 (S8, T49): the standing-stage weight moved
 * from `boosts` (the 12 of EVAL_WEIGHTS.boostStage) to `boostsBiting`, the
 * same stages damped by the share of living foes they bite. REPLACEMENT fit on
 * the r69-b0 capture, 10,350 positions of 1,363 sets, rest of the table at
 * hand: out of fold better in 20 of 20 seeds (log-loss -16 bp, Brier 20 of
 * 20), boostsBiting 95 [77, 112], no flagged band. The ADDITIVE fit (boosts
 * kept at 12, boostsBiting 74) reads another 14 bp better; by the
 * pre-registered order (REPLACEMENT before ADDITIVE) the replacement is the
 * step that is measured, the additive form waits for that reading.
 *
 * Round 69 (S9, T102): `statusFix` takes the weight of `bodies`, so a body whose
 * ability changes what a status costs is priced at the right multiplier (the
 * fold: out of fold better than the table in 20 of 20 seeds, log-loss -8 bp,
 * 968 statused positions). The phase form of this family (bodies and matchup
 * with the share of fainted mons, score/phase-form.ts) rides on top of this
 * table behind a switch; the other four tables hold statusFix at 0 (their
 * fold lost out of fold: 0 of 20 seeds in the two Scarlet/Violet doubles
 * tables, too few statused positions in Champions).
 */
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
  pairFocus: 0,
  pairRedirect: 0,
  boostsBiting: 0,
  statusFix: 0,
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
 *
 * Round 69 (S7, T42): pairFocus fitted free on the 3,893 VGC positions of 711
 * sets (r69-b0 capture, rest of the table at hand): -188 [-284, -94], out of
 * fold better in 20 of 20 seeds. The sign is the reverse of the cell's
 * reading (a pair that can double up on a foe the singles cannot KO); the
 * bank and the VGC holdout decide (R3) whether the weight stays. User gate of
 * 13.10. (6b): pairFocus is 0 again. The cell is a 0/1 gate, and at -188 the
 * VGC score fell as a foe took damage in 24 of 103 HP series of the 54 VGC
 * positions (largest fall 0.098); T199 builds a ramp over the KO window and
 * refits.
 *
 * Round 69 (S12, T144): the August values for tailwind (68) and coverage (40)
 * and the fit that kept them (round 66, 14 of 20 seeds) priced what the
 * matchup already holds: the matchup term reads the doubled speed of a
 * Tailwind (speed.ts; on 35 doubles positions with one side under Tailwind it
 * moves 0.112 toward that side, 27 up and none down), and Coverage grows with
 * the same margins (correlation 0.43 with the matchup, 0.32 with the bodies;
 * alone its fit is +24, with the matchup in the model -44). The flag itself
 * is right (3,779 of 3,779 positions agree with the log, four turns with the
 * set turn). One side has Tailwind in 15.8 % of the positions, both in 1.6 %,
 * and the side with it wins 45 % of those, where the other columns alone
 * predict 43.5 % and the hand weight 53.6 %. The refit on the r69-b0
 * capture (3,779 positions of 711 sets) holds tailwind and coverage at 0 and
 * refits bodies 177, screens 48, matchup 169 and Trick Room 54 (hazards stay
 * at the hand value, R2 flagged): out of fold better in 20 of 20 seeds, Brier
 * 20 of 20, log-loss -62 bp, Brier -24 bp against the table before.
 *
 * Round 69 (S17, T49): `boosts` 27 replaced by boostsBiting 16 (REPLACEMENT on
 * the Schluss-Fit corpus, 32,088 positions, with stage drops counted: 16.1
 * [2.8, 30.7], out of fold better in 20 of 20 seeds, Brier 20 of 20, log-loss
 * -126 bp, no flagged band; before the drops counted the column was flagged
 * and missed R1). The bank and the VGC holdout decide it (R3).
 */
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
 * screens and tailwind lack support in Champions OU. Round 67 (wave 2,
 * decision 31): refit on the faithful reconstruction (T145, the Champions
 * mod; T143, the Champions OU set file), 1,972 positions of 285 sets, the
 * free weights land on bodies 122 [87, 159], hazards 1.07 [0.54, 1.65] and
 * matchup 252 [102, 427] and lose out of fold in 20 of 20 seeds (log-loss
 * +62 bp): the table stays. Round 69 (S8, T49): `boosts` 12 replaced by
 * boostsBiting 102 [62, 152] (REPLACEMENT, 1,971 positions of 285 sets, out
 * of fold better in 20 of 20 seeds, log-loss -19 bp). Written out in full,
 * so an edit of the singles table never moves a held Champions weight.
 */
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

/**
 * Champions doubles: every Champions doubles format reads this table, fitted
 * 2026-10-09 (round 66, T137) on Champions VGC at the fixed doubles K: 2,601
 * positions of 386 sets (rated Bo1 ladder games of regulations M-A, M-B and
 * M-C and the Bo3 tournament games, two thirds of their sets; the third is
 * the holdout; unrated challenges played after a ladder ended stay out of
 * the fit), the corpus measured like the app with Champions usage and set
 * files (T141, T142), folds and bootstrap clustered by set. Out of fold it
 * beats the hand doubles table in 20 of 20 seeds (log-loss −25.3 bp, Brier
 * −10.8 bp). Fitted with their 90 % band: screens 83 [45, 122], bodies 196
 * [171, 223], matchup 96 [44, 151]. Held at the hand table: coverage,
 * hazards, tailwind and Trick Room (the first pass flagged them), the boost
 * and choice-mismatch weights. On the holdout's 491 games the search reads
 * −16 bp [−35, +3] (early −45 [−86, −7], regulation M-C −50 [−92, −13]; own
 * K per phase −6), no harm. Round 65's fit on 283 sets, most of them unrated
 * challenges, won 7 of 20 seeds. Adopted at the round-66 gate ("2a").
 * Round 67 (wave 2, decision 31): refit on the faithful reconstruction
 * (T145, the Champions mod), 2,605 positions of 386 sets, bodies 197
 * [173, 225], screens 84 [46, 123] and matchup 107 [58, 161] lose out of
 * fold in 20 of 20 seeds (log-loss +28 bp): the table stays. Written out
 * in full. Round 69 (S8, T49): `boosts` 27 replaced by boostsBiting 87
 * [64, 120] (REPLACEMENT, 2,604 positions of 386 sets, out of fold better in
 * 20 of 20 seeds, log-loss -30 bp, and 20 of 20 against the additive form).
 * Round 69 (S17): boostsBiting 87 -> 61 [42, 81], the Schluss-Fit on the
 * corpus with stage drops counted (32,088 positions; Brier better in 16 of 20
 * seeds, the log-loss in 19 of 20). The lane value lies outside the new band
 * and the new value outside the lane band, so decision 3 (user answer 2a)
 * takes the fit value.
 */
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

/** The weight table of a game type under a rule set. */
export function featureWeights(doubles: boolean, ruleset: StaticRuleset = 'standard'): Record<keyof EvalFeatures, number> {
  if (ruleset === 'champions') return doubles ? CHAMPIONS_DOUBLES_FEATURE_WEIGHTS : CHAMPIONS_FEATURE_WEIGHTS;
  if (!doubles) return FEATURE_WEIGHTS;
  return ruleset === 'vgc' ? VGC_DOUBLES_FEATURE_WEIGHTS : DOUBLES_FEATURE_WEIGHTS;
}
