/** The static evaluation's tuning: the point weights, the raw feature vector and the per-game-type feature weights. */

/**
 * All tuning in one place. Values are points on an arbitrary scale; the final score is normalized to [-1, +1].
 * Tactics (KO ranges, speed order) come from the search, not from here: this stays positional.
 */
export const EVAL_WEIGHTS = {
  /** Flat value of a living Pokémon (bodies matter most). */
  alive: 100,
  /** Value of a full health bar, scaled by the current HP fraction. */
  hp: 100,
  /** Multipliers applied to a statused Pokémon's (alive + hp) contribution. */
  status: { brn: 0.85, par: 0.85, psn: 0.9, tox: 0.7, slp: 0.8, frz: 0.75 } as Record<string, number>,
  /**
   * Per boost stage on an active Pokémon (boosts vanish on switch): base points × the diminishing schedule. Offensive stages
   * (atk/spa/spe) carry games; defensive stages read at half weight. The payoff of a setup turn must live in the static eval,
   * because deeper search cannot see past its horizon. The singles table prices the stages through boostsBiting and reads 0 for
   * `boosts`; these 12 and 6 stay as the 2:1 split both columns share.
   */
  boostStage: { offensive: 12, defensive: 6 },
  /** Cumulative stage multipliers (index = |stage|): +2 is twice +1, the tail flattens. */
  boostSchedule: [0, 1.0, 2.0, 2.5, 3.0, 3.15, 3.3],
  /** Boosts on a statused sweeper sit on a timer (Toxic outruns recovery): the accumulated stages are worth less; psn and brn erode slower. */
  boostStatusDiscount: { tox: 0.5, psn: 0.8, brn: 0.8 } as Record<string, number>,
  /**
   * Hazards are priced by their victims, not per layer: each living Pokémon on the suffering side contributes its body weight ×
   * the entry-damage fraction the type chart assigns it (a 4x-rock Volcarona bleeds 50% per entry, a Lucario 6%) × the expected
   * future entries.
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
  /** Extra weight on active-vs-active pairs in the matchup term: the field applies the pressure, and every leads cell shares the same teams. */
  activePair: 1.5,
  /**
   * Uncovered-threat term: max-based per enemy, unlike the sum-based matchup. An enemy that no remaining teammate trades favorably
   * against is a wincon-in-waiting, and the sum dilutes that into an average. Weighted per uncovered enemy by its remaining HP.
   */
  coverage: 40,
  /**
   * A Choice item on a status-heavy moveset is a liability: the holder can never run its game plan again (the anti-setup Trick).
   * Scaled by the holder's status-move fraction: 4 attacks give 0.
   */
  choiceMismatch: 40,
  /**
   * Early-game damp on the matchup feature value: at zero faints the term reads at damp × matchup, scaling linearly to full weight
   * at 1/3 of all bodies fainted. 1.0 = off. A phase multiplier folded into the raw value, not independently fittable.
   */
  matchupEarlyDamp: 1.0,
  /**
   * Fraction of a removal option's net board-state relief that counts: removal costs a tempo turn and can be punished. See
   * hazardRemovalEquity: the net is move-aware (Defog also destroys the side's own hazards on the opponent's board; a net-negative
   * option counts zero). Folded into the raw hazard value, not fittable.
   */
  hazardRemovalDiscount: 0.5,
  /**
   * Alive-share multiplier for a stranded bench mon: one whose HP cannot survive re-entering through its own side's hazards while
   * the side has no living removal carrier. Its hp share prices at effHp (0 when stranded); the rest is fodder/absorber value.
   */
  strandedAlive: 0.5,
} as const;

/**
 * Raw, unweighted feature values (p1-positive differences). The score is the weighted sum through tanh: one code path shared by
 * scoring and the fitting harness. Multiplicative modifiers are not independent features: status and item multipliers fold into
 * `bodies`, the status discount into `boosts`, the offensive/defensive split and the cap/entries coupling into their raw values.
 * Only the top-level FEATURE_WEIGHTS are fittable.
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
   * Win-condition value of standing boosts, split by how the sweep would play out. Per side, over living mons with a positive
   * offensive stage, each pair the boost flips (beats 1v1 boosted, loses unboosted, on no stages at all) contributes
   * 1/enemies × hpFraction into exactly one cell: fast = the sweeper acts first (movesFirst: priority, effective speed,
   * Trick Room), ko = the boosted best-move fraction covers the target's current HP. Weight 0 in every table.
   */
  sweepFastKo: number;
  sweepFastChip: number;
  sweepSlowKo: number;
  sweepSlowChip: number;
  /**
   * The field pair of a doubles board, p1-positive differences, 0 in singles, weight 0 in every table. pairFocus: a foe on the
   * field that neither of the side's two actives KOs alone and both KO together, valued by the second attacker's marginal share
   * of the foe's HP, over the foes on the field. pairRedirect: a living Follow Me or Rage Powder user next to a partner with
   * damage, valued by the partner's best share of a foe's HP it covers, at the redirector's HP (score/field-pair.ts).
   */
  pairFocus: number;
  pairRedirect: number;
  /**
   * `boosts` with every standing stage damped by the share of living foes it bites (score/boost-bite.ts): a foe bites back the
   * stage when it plays Unaware (asked from the simulator's ModifyBoost), clicks a move that takes the stages away (Haze, Clear
   * Smog, Roar and the like, played in the simulator), or when the stage buys no KO, no slower foe KO and no move order within a
   * few turns of the race. Same sign and scale as `boosts`, p1-positive difference; where a table prices it, it replaces `boosts`.
   * A boost counts against a foe only where the holder wins the race with it and gets to act in it, a drop only where the foe
   * does (score/boost-race.ts); the foes on the field gate the stage for everybody behind them, and the end-of-turn HP of the
   * bodies in the race (Leech Seed, Leftovers, weather) is played in the simulator (score/residuals.ts).
   */
  boostsBiting: number;
  /**
   * What the status multiplier of `bodies` gets wrong for a body whose ability changes what the status costs. Per living body,
   * (the right multiplier minus the applied one) times the body's share before the status multiplier, p1-positive difference.
   * The right multiplier is played in the simulator (score/status-factor.ts): 1 where the ability turns the status into a gain
   * (Poison Heal, Guts, Quick Feet, Marvel Scale, Toxic Boost, Flare Boost), part of the way to 1 where it cancels only some of
   * the cost (Magic Guard under burn: the chip is gone, the halved Attack stays). 0 for every body without such an ability.
   * At the weight of `bodies` it folds the right multiplier in.
   */
  statusFix: number;
}

/**
 * The hand singles table. `boostsBiting` carries the standing-stage weight (`boosts` is 0); `statusFix` takes the weight of
 * `bodies`, so a body whose ability changes what a status costs is priced at the right multiplier. The phase form (bodies and
 * matchup with the share of fainted mons, score/phase-form.ts) rides on top of this table behind a switch; the other four
 * tables hold statusFix at 0.
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
 * Doubles OU and every doubles format outside VGC and Champions, fitted on the Scarlet/Violet doubles corpus; the boost weights, tailwind
 * and choice mismatch are held.
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
 * VGC outside Champions (doubles; bring six, pick four, level 50): the hand values of the Scarlet/Violet doubles table with bodies,
 * screens, matchup and Trick Room fitted on VGC games (hazards and choice mismatch held). Written out in full, so a refit of Doubles OU
 * never moves it. Tailwind and coverage stay 0: the matchup term already reads the doubled speed of a Tailwind and coverage grows
 * with the same margins, so a weight would price them twice. pairFocus stays 0: the cell is a 0/1 gate, and a negative weight made
 * the score fall as a foe took damage. `boostsBiting` replaces `boosts`.
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

/** The rule set a battle runs under, named by the host from the replay's format (replayRuleset) and passed as EvalSettings.ruleset: the simulator knows no Champions format. */
export type StaticRuleset = 'standard' | 'vgc' | 'champions';

/**
 * Champions OU (singles), fitted on its own games: its fitted weights part from the Scarlet/Violet games' (bodies 121 and
 * matchup 210 against the singles table's 200 and 120). Held: coverage, boost, Trick Room and choice mismatch; screens and tailwind
 * lack support in Champions OU. `boostsBiting` replaces `boosts`. Written out in full, so an edit of the singles table never
 * moves a held Champions weight.
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
 * Champions doubles: every Champions doubles format reads this table. Fitted on Champions VGC games: bodies 196, screens 83, matchup 96.
 * Held at the hand values of the Scarlet/Violet doubles table from before the Doubles OU refit (coverage 40, hazards 0.75, tailwind 68,
 * Trick Room 87, choice mismatch 40), which is not `DOUBLES_FEATURE_WEIGHTS` today. `boostsBiting` replaces `boosts`. Written out in full.
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

/** The weight table of a game type under a rule set: Champions and VGC outside Champions have their own, a VGC singles game reads the singles table. */
export function featureWeights(doubles: boolean, ruleset: StaticRuleset = 'standard'): Record<keyof EvalFeatures, number> {
  if (ruleset === 'champions') return doubles ? CHAMPIONS_DOUBLES_FEATURE_WEIGHTS : CHAMPIONS_FEATURE_WEIGHTS;
  if (!doubles) return FEATURE_WEIGHTS;
  return ruleset === 'vgc' ? VGC_DOUBLES_FEATURE_WEIGHTS : DOUBLES_FEATURE_WEIGHTS;
}
