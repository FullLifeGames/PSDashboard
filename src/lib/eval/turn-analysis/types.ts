import type { EvalResult, KoOddsInfo, RankedChoice, ReadRecommendation } from '../types';
import type { StreakHistoryEntry, StreakOdds } from '../streaks';
import type { PlayedAction, PlayedTurn, SackInfo } from '../played';
import type { SideId } from '../../ids';

/**
 * The turn analysis' vocabulary: the verdict bands and their tuning
 * constants, the per-side and per-turn records analyzeTurn produces, the
 * spoken-once keys the game report walks with, and analyzeTurn's own
 * parameter shape. Types and constants only.
 */

export type Side = SideId;

/**
 * Chess-style verdict bands on the EV-regret, in WP-UNITS (0.1 = 5% win
 * probability): 5% / 10% / 20% win-prob loss. Half of Lichess's 10/20/30
 * bands — deliberately: the score-space thresholds flagged ~3–5% losses as
 * mistakes (the T22/T26/T29 over-flagging), while full Lichess bands would
 * barely flag anything at this engine's confidence levels.
 */
export type VerdictTier = 'inaccuracy' | 'mistake' | 'blunder';
export const TIER_THRESHOLDS: Record<VerdictTier, number> = {
  inaccuracy: 0.1,
  mistake: 0.2,
  blunder: 0.4,
};
/**
 * Lichess-style leniency: once the game is this decided (own perspective;
 * 0.7 wp-units = 85% win probability), verdicts soften one tier — piling
 * blame onto a lost position teaches nothing, and a winning position
 * forgives small imprecision. KEPT after the wp-unit conversion: sigmoid
 * compression already shrinks decided-position regrets, but garbage-time
 * turns still produce band-crossing regrets when the leaf spread is wide.
 */
export const DECIDED_SCORE = 0.7;

/**
 * Own-perspective score at or above which a HEALTHY-body feed can read as a
 * deliberate simplification sack (both before and after the sack). Anchored
 * to the calibration buckets: |score| 0.4–0.7 wins for the favored side 77%
 * of the time — "decisively ahead", where surplus material buys certainty.
 */
export const HEALTHY_SACK_FLOOR = 0.4;

/** Regret (best − played, own perspective) that marks a decision problem. */
export const REGRET_THRESHOLD = TIER_THRESHOLDS.mistake;
/**
 * Residual swing (actual − expected outcome) that marks a chance swing.
 * Derived from the tier bands (re-derived with them for wp-units): the roll
 * "mattered" when it moved the game a mistake-sized amount.
 */
export const CHANCE_THRESHOLD = TIER_THRESHOLDS.mistake;

export type TurnAttribution =
  | 'p1-decision' | 'p2-decision' | 'both-decision'
  /** A flagged risk whose read won real value — graded as a good play, not a mistake. */
  | 'p1-read' | 'p2-read' | 'both-read'
  | 'chance'
  /** A meaningful swing with no single culprit: decision and chance parts each stay under their thresholds. */
  | 'shift'
  | 'quiet' | 'unclear';

/**
 * A risk pays off when the actual pair's expected value beats the safe
 * line's GUARANTEE by at least this much (own perspective). Comparing
 * against the floor is deliberate: the guarantee is exactly what the safe
 * player locks in — beating it is what the read earned. Derived from the
 * tier bands (wp-units): an inaccuracy-sized edge is a real edge.
 */
export const RISK_PAYOFF_MARGIN = TIER_THRESHOLDS.inaccuracy;

/**
 * Measurement-noise tolerance UNDER the payoff margin for the paid-off
 * credit only: static-eval repricing legitimately moves guarantees at the
 * third decimal, and a knife-edge credit must not flip with it (648453
 * t20: a pinned paid-off read at 0.1006 fell to 0.0972 when stranded
 * pricing moved the safe floor by 0.0033). Same epsilon scale as the
 * rank-tie and feed-certainty gates. The feed payoff gate and the
 * clearly-failed exit stay strict — this widens praise, never excuses.
 */
export const RISK_PAYOFF_EPSILON = 0.02;

/**
 * How many FUTURE turns a read gets to cash in: setup and positional plays
 * bank their payoff over the following expected outcomes, not one turn. The
 * chain uses depth-matched expectations only — rolls stay in the luck ledger.
 */
export const PAYOFF_WINDOW = 3;

/**
 * A stay-and-die feed's floor gate: the realized outcome may exceed the
 * played line's priced floor by at most this much to count as "the player
 * accepted the known worst case and got it" (573756 t68: realized = floor
 * exactly). Round 12 replaced the old certainty gate (ev ≈ floor) with
 * this — a race-priced feed turn carries real spread, but as long as the
 * WORST branch is what materialized, the turn's own rolls contributed
 * nothing positive and the windowed payoff credits the plan, not the luck.
 * Same epsilon scale as the rank-tie threshold.
 */
export const FEED_FLOOR_EPSILON = 0.02;

/**
 * Both sides must have at least this many VIABLE options (within an
 * inaccuracy of best) before a culprit-free swing reads as a genuinely open
 * turn instead of a drift (562428 t10: the expert counted four-plus live
 * options per side and called the turn a read, not a shift).
 */
export const BREADTH_MIN_OPTIONS = 4;

/**
 * A recommendation conflicts with the engine's own play when the side's
 * equilibrium mix puts at least this much weight on a DIFFERENT choice than
 * the argmax-EV pick — the "better was X" line then owes the reader the
 * condition under which X actually is the pick (653785 t19).
 */
export const CONDITIONAL_MIX_MIN = 0.5;

/**
 * An equilibrium mix this concentrated on one SWITCH reads as "effectively
 * forced" — the forced-sac situations whose expectation the narrative names
 * in prose instead of leaving the percentage in matrix header badges.
 */
export const FORCED_MIX_THRESHOLD = 0.85;

/**
 * One re-evaluation of the flagged side's turn under an ALTERNATIVE item on
 * an opposing mon whose item is only a usage guess. EVs are own-perspective
 * pair values, same space as RankedChoice.ev.
 */
export interface SensitivityProbe {
  species: string;
  item: string;
  playedEv: number;
  bestEv: number;
}

/** Per-side probes for one turn — the shape sweeps cache and analyzeTurn consumes. */
export interface TurnSensitivity {
  p1?: SensitivityProbe[];
  p2?: SensitivityProbe[];
}

export interface SideAnalysis {
  playedRaw: PlayedAction | null;
  /**
   * The protocol's reason a chosen action never surfaced ('slp', 'flinch',
   * 'move: Taunt', 'faint', …) — the side DID pick something.
   */
  prevented?: string;
  /** The side was KO'd before it ever acted — `played` is a charitable
   * outcome-equivalent stand-in ("stayed in") for the hidden move choice,
   * gradable against the engine's best; risk framing stays off. */
  neverActed?: boolean;
  /** Doubles: the per-slot actions this side actually took. */
  playedSlots?: (PlayedAction | null)[];
  /** The played action matched into the engine's ranked list. */
  played: RankedChoice | null;
  /** The top choice by equilibrium EV — the grading reference. */
  best: RankedChoice | null;
  /** The max-floor choice — "the engine's safe line", the safety reference. */
  safe: RankedChoice | null;
  /** best.ev − played.ev (own perspective), floored at 0. */
  regret: number | null;
  /**
   * The regret's floor priced in a punishing reply the opponent did NOT
   * click — a prediction play whose read came true, not a punished misplay.
   */
  riskUnpunished?: boolean;
  /** Own-perspective value of the actual pair over the safe line's floor. */
  riskPayoff?: number;
  /** Turns AFTER this one until the payoff peaked (absent = immediate). */
  riskPayoffTurn?: number;
  /**
   * The read won at least RISK_PAYOFF_MARGIN over the safe guarantee. Also
   * set on UNTIERED turns when the play was a genuine gamble (deviated from
   * the engine's pick, gave up a mistake-sized floor) that landed.
   */
  riskPaidOff?: boolean;
  /**
   * The flagged risk MATCHES the opponent model's best response — phrased
   * as "a read against the opponent's tendencies" (grading unchanged).
   */
  riskWasRead?: boolean;
  /**
   * A slot's choice was never observed (flinch/sleep — the protocol shows
   * `|cant|`): `played` is the BEST combo consistent with the visible slots,
   * so the regret is a charitable lower bound, never blame for hidden picks.
   */
  playedPartial?: boolean;
  /** A depth+1 verification pass cleared the shallow misplay flag. */
  verifiedAtDepth?: boolean;
  /** Verdict band for the regret, after leniency (absent = clean play). */
  tier?: VerdictTier;
  /**
   * The flagged turn fed a body deliberately — a nearly-dead Pokémon
   * (≤ SACK_HP_THRESHOLD at turn start, unconditional) or a HEALTHY one
   * while the engine's scores stayed ≥ HEALTHY_SACK_FLOOR on both sides of
   * the sack (simplification). Graded as a sack: tier demoted one band —
   * cleared entirely for a stayed feed whose windowed payoff repaid the
   * full regret plus the margin (`verified`) — never labeled a risk.
   */
  sacrifice?: SackInfo;
  /**
   * How many options the engine ranked for this side — 1 marks a forced
   * turn (or the waiting sentinel), which accuracy grading must exclude.
   */
  choiceCount?: number;
  /**
   * The verdict HINGES on a guessed item: under some usage-plausible
   * alternative set the regret lands in a softer band. The tier above is
   * already softened to the most charitable probed band (acquit-only —
   * probes never add blame).
   */
  sensitivity?: { species: string; alternatives: { item: string; tier: VerdictTier | 'none' }[] };
  /**
   * How many ranked options sit within an inaccuracy of best — the side's
   * real decision breadth. Both sides clearing BREADTH_MIN_OPTIONS turns a
   * culprit-free shift into an "open turn" in the narrative.
   */
  viableCount?: number;
  /**
   * The engine's own equilibrium leans a DIFFERENT choice than the argmax-EV
   * recommendation (weight ≥ CONDITIONAL_MIX_MIN): the narrative renders the
   * recommendation conditionally. bestWhen/mixWhen name the opponent replies
   * against which each choice earns its keep (largest own-perspective value
   * difference in the solved matrix); null when no reply favors that side of
   * the split. Only computed on tiered turns — where a recommendation renders.
   */
  conditional?: { mixLabel: string; mixWeight: number; bestWhen: string | null; mixWhen: string | null };
  /**
   * The recommended best is MECHANICALLY NULL against the opposing active
   * (Will-O-Wisp into a Fire-type). `alternative` is a co-optimal option
   * within the rank-tie epsilon that is not itself null — the narrative
   * displays it in place of the null pick (grading untouched); with no such
   * option the narrative keeps the true best and names the caveat.
   */
  bestNull?: { reason: string; alternative: { label: string; ev: number; koOdds?: KoOddsInfo } | null };
  /**
   * The side's equilibrium mix all but commits to one SWITCH
   * (≥ FORCED_MIX_THRESHOLD with more than one option) — a forced-sac /
   * forced-pivot expectation the narrative names in prose.
   */
  forcedMix?: { label: string; weight: number };
  /**
   * Multi-turn expectation cumulation (round 6): a milestone streak of
   * secondary fishing or crit accumulation ending on this turn. Render-time
   * narrative only — grading never sees it.
   */
  streakOdds?: StreakOdds;
  /**
   * The punishing counterfactual the solved matrix already knows (round 13):
   * the own row that best answers the opponent's ACTUAL click, when it beats
   * the played line in that column by a mistake-sized gain. The shift
   * narrative renders it as the concrete read that was on the table
   * (562428 t10: → Heatran into the Horn Leech). Display-only, never grades;
   * fails closed without machine choice ids or a known opponent action.
   */
  hindsightRead?: { response: string; against: string; gain: number };
  /**
   * The turn brings in a mon the opponent has no live race answer to
   * (round 13, root profile from the search): entering it cleanly is profit
   * on its own — the opponent can only sacrifice into it (648453 t13,
   * Lopunny-Mega). Set when the played or recommended line's entry target
   * ("→ X", a pivot's "U-turn → X" included) is on the own unanswered
   * list; display-only, never grades. With `heldBy` (round 14) the mon sits
   * in the SWITCH-IN stage instead: every bench answer dies on arrival and
   * only the named standing active still holds the pair.
   */
  unanswered?: { species: string; heldBy?: string };
  /**
   * Round 15: the board is practically decided FOR this side — one own mon
   * clears the whole living enemy team in sequence and survives the
   * expected return fire (the search root's decided sweep). A board STATE,
   * not click context: present on every decided turn so display layers can
   * book the resolution prose; `announce` is true only until the game
   * report has spoken the sentence once (the per-turn card, which passes
   * no seen-set, announces on every decided turn).
   */
  decided?: { species: string; announce: boolean };
  /**
   * Round 15: one high-odds click from decided — `odds` (accuracy × kill
   * share, round 6) on the click that removes `removes`, after which
   * `species` clears the rest (573756 t73: a 95% Fire Fang from the sweep).
   */
  nearDecided?: { species: string; odds: number; removes: string; announce: boolean };
}

/**
 * Spoken-once key for the game report's entry sentences (round 14): the
 * report walk collects the keys it has already spoken and passes them back
 * in via `unansweredSeen`, so a mon's entry sentence appears on its FIRST
 * entry only (573756: ten identical Zapdos-Galar sentences). Each stage is
 * its own statement — a spoken held-pair sentence never mutes the later,
 * stronger no-answer one.
 */
export const unansweredSeenKey = (side: 'p1' | 'p2', signal: { species: string; heldBy?: string }): string =>
  `${side}:${signal.species}:${signal.heldBy ? 'held' : 'open'}`;

/**
 * Spoken-once key for the decided/near-decided announcements (round 15),
 * same regime as unansweredSeenKey: a `removes` target marks the near
 * stage. Each stage (and each new removal target) is its own statement —
 * a spoken near sentence never mutes the later full decided one.
 */
export const decidedSeenKey = (side: 'p1' | 'p2', signal: { species: string; removes?: string }): string =>
  signal.removes ? `${side}:${signal.species}:near:${signal.removes}` : `${side}:${signal.species}:decided`;

/** Deep re-search of the played and best pairs (p1-perspective outcomes). */
export interface VerifiedOutcomes {
  playedDeep: number;
  bestDeep: number;
}
export interface TurnVerification {
  p1?: VerifiedOutcomes;
  p2?: VerifiedOutcomes;
}

export interface TurnAnalysis {
  turn: number;
  scoreBefore: number;
  scoreAfter: number | null;
  swing: number | null;
  /** Engine expectation of the actually played pair (p1 perspective). */
  playedOutcome: number | null;
  /** playedOutcome − scoreBefore: the predictable consequence of the choices. */
  decisionDelta: number | null;
  /** scoreAfter − playedOutcome: rolls, crits, and model error. */
  chanceDelta: number | null;
  attribution: TurnAttribution;
  p1: SideAnalysis;
  p2: SideAnalysis;
  /**
   * False when played actions were never parsed (doubles) — score movement
   * and engine lines still apply, but nothing may claim blame or "could not
   * act". Absent means true.
   */
  playedTracking?: boolean;
}

/** analyzeTurn's input: the sweep's cached per-turn data plus the render-time context. */
export interface AnalyzeTurnParams {
  turn: number;
  result: EvalResult;
  played: PlayedTurn | null;
  playedOutcome: number | null;
  /**
   * Expected pair values of the FOLLOWING turns (p1 perspective) — lets a
   * read's payoff cash in over PAYOFF_WINDOW turns of expected play.
   */
  futureOutcomes?: (number | null)[];
  /**
   * Deep re-search of flagged turns (chess.com's sacrifice-verification
   * pattern): when the depth+1 pair values say the played line holds up,
   * the misplay verdict is cleared. Confirming passes change nothing.
   */
  verified?: TurnVerification | null;
  scoreBefore: number;
  scoreAfter: number | null;
  /** False = played actions unavailable (doubles); blame is off the table. */
  playedTracking?: boolean;
  /** Per-side low-HP sacrifices detected in the turn's protocol (played.ts). */
  sacks?: { p1?: SackInfo; p2?: SackInfo };
  /** Per-side opponent-model best responses (opponent-model.ts computeRead). */
  reads?: { p1?: ReadRecommendation | null; p2?: ReadRecommendation | null };
  /**
   * Per-side item-sensitivity probes for flagged turns (useEvaluation).
   * Acquit-only: a probe can soften the side's verdict, never harshen it.
   */
  sensitivity?: TurnSensitivity | null;
  /**
   * Active species at turn start (singles: exactly one per side, else null)
   * plus the replay generation — the null-move guard's board context.
   * Absent/null species keep the guard off (fail closed).
   */
  actives?: { p1: string | null; p2: string | null; gen: number } | null;
  /**
   * Per-side played-move history for the whole game (index t−1 = turn t,
   * the current turn included) — the streak detector's input. Render-time
   * only, fail closed when absent.
   */
  playedHistory?: { p1: (StreakHistoryEntry | null)[]; p2: (StreakHistoryEntry | null)[] } | null;
  /**
   * Entry sentences the game report has already spoken (round 14), keyed by
   * unansweredSeenKey — the report walk passes its collected keys so each
   * mon's stage speaks once; the per-turn card omits this and keeps the
   * sentence on every entry turn.
   */
  unansweredSeen?: ReadonlySet<string> | null;
  /**
   * Decided/near-decided announcements the game report has already spoken
   * (round 15), keyed by decidedSeenKey — same walk regime as
   * unansweredSeen. The signal STATE stays present regardless; only
   * `announce` flips off.
   */
  decidedSeen?: ReadonlySet<string> | null;
}
