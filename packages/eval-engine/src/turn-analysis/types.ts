import type { EvalResult, ForcedWin, ForcedWinCaveat, ForcedWinOpen, KoOddsInfo, RankedChoice, ReadRecommendation } from '../types.ts';
import type { StreakHistoryEntry, StreakOdds } from '../streaks.ts';
import type { PlayedAction, PlayedTurn, SackInfo } from '../played.ts';
import type { TurnRolls } from '../dice-events.ts';
import type { RulesMod, SideId } from '@fulllifegames/replay-core';
import type { PlayerTendencies } from '../opponent-model.ts';

/** The turn analysis' vocabulary: verdict bands and tuning constants, the records analyzeTurn produces, the spoken-once keys, its parameters. */

export type Side = SideId;

/** A verdict band on the EV-regret. */
export type VerdictTier = 'inaccuracy' | 'mistake' | 'blunder';
/** Regret thresholds of the verdict bands in wp-units (0.1 = 5% win probability); half of Lichess's 10/20/30 bands, which would barely flag anything here. */
export const TIER_THRESHOLDS: Record<VerdictTier, number> = {
  inaccuracy: 0.1,
  mistake: 0.2,
  blunder: 0.4,
};
/**
 * Once the game is this decided (own perspective; 0.7 wp-units = 85% win probability), verdicts soften one tier: blame on a lost position
 * teaches nothing, a winning position forgives small imprecision. Garbage-time turns still cross bands when the leaf spread is wide.
 */
export const DECIDED_SCORE = 0.7;

/**
 * Own-perspective score at or above which a healthy-body feed can read as a deliberate simplification sack (before and after the
 * sack). Anchored to the calibration buckets: |score| 0.4 to 0.7 wins for the favored side 77% of the time.
 */
export const HEALTHY_SACK_FLOOR = 0.4;

/** Regret (best − played, own perspective) that marks a decision problem: a mistake-sized one. */
export const REGRET_THRESHOLD = TIER_THRESHOLDS.mistake;
/**
 * Residual swing (actual − expected outcome) that marks a chance swing: the roll mattered when it moved the game a mistake-sized amount.
 */
export const CHANCE_THRESHOLD = TIER_THRESHOLDS.mistake;

/** Who or what moved a turn's score. */
export type TurnAttribution =
  | 'p1-decision' | 'p2-decision' | 'both-decision'
  /** A flagged risk whose read won real value — graded as a good play, not a mistake. */
  | 'p1-read' | 'p2-read' | 'both-read'
  | 'chance'
  /** A meaningful swing with no single culprit: decision and chance parts each stay under their thresholds. */
  | 'shift'
  | 'quiet' | 'unclear';

/**
 * A risk pays off when the actual pair's expected value beats the safe line's guarantee (its floor: what the safe player locks in)
 * by at least this much, own perspective.
 */
export const RISK_PAYOFF_MARGIN = TIER_THRESHOLDS.inaccuracy;

/**
 * Measurement-noise tolerance under the payoff margin, for the paid-off credit only: static-eval repricing moves guarantees at
 * the third decimal, and a knife-edge credit must not flip with it (a paid-off read at 0.1006 fell to 0.0972 when the safe floor
 * moved by 0.0033). The feed payoff gate and the clearly-failed exit stay strict: this widens praise, never excuses.
 */
export const RISK_PAYOFF_EPSILON = 0.02;

/** How many future turns a read gets to cash in; the chain uses depth-matched expectations only, rolls stay in the luck ledger. */
export const PAYOFF_WINDOW = 3;

/**
 * A stay-and-die feed's floor gate: the realized outcome may exceed the played line's priced floor by at most this much to count
 * as "the player accepted the known worst case and got it". A race-priced feed turn carries real spread, but when the worst
 * branch materialized, the turn's own rolls added nothing and the windowed payoff credits the plan, not the luck.
 */
export const FEED_FLOOR_EPSILON = 0.02;

/**
 * Both sides need this many viable options (within an inaccuracy of best) before a culprit-free swing reads as an open turn, not a drift.
 */
export const BREADTH_MIN_OPTIONS = 4;

/**
 * A recommendation conflicts with the engine's own play when the equilibrium mix puts this much weight on a different choice than the
 * argmax-EV pick.
 */
export const CONDITIONAL_MIX_MIN = 0.5;

/** An equilibrium mix this concentrated on one switch reads as "effectively forced" and is named in prose. */
export const FORCED_MIX_THRESHOLD = 0.85;

/** One re-evaluation of the flagged side's turn under an alternative item on an opposing mon whose item is a usage guess; EVs are own-perspective. */
export interface SensitivityProbe {
  species: string;
  item: string;
  playedEv: number;
  bestEv: number;
}

/** Per-side item-sensitivity probes for one turn: what the sweeps cache and analyzeTurn consumes. */
export interface TurnSensitivity {
  p1?: SensitivityProbe[];
  p2?: SensitivityProbe[];
}

/** One side's grading and narrative signals for one turn. */
export interface SideAnalysis {
  /**
   * The fainted share of the turn this record was read at (an echo of the param); the side's percent texts print at it, no grade reads
   * it.
   */
  faintedFraction?: number;
  playedRaw: PlayedAction | null;
  /** The setup move the side clicked (playedSetupMove), read by the replay's own Dex; absent for none. */
  setupMove?: string;
  /** The protocol's reason a chosen action never surfaced ('slp', 'flinch', 'move: Taunt', 'faint', ...): the side did pick something. */
  prevented?: string;
  /**
   * KO'd before it acted: `played` is a charitable stand-in ("stayed in") for the hidden choice, gradable against best; risk framing
   * stays off.
   */
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
   * The regret's floor priced in a punishing reply the opponent did not click: a prediction play whose read came true, not a punished
   * misplay.
   */
  riskUnpunished?: boolean;
  /** Own-perspective value of the actual pair over the safe line's floor. */
  riskPayoff?: number;
  /** Turns AFTER this one until the payoff peaked (absent = immediate). */
  riskPayoffTurn?: number;
  /**
   * The read won at least RISK_PAYOFF_MARGIN over the safe guarantee; also set on untiered turns for a genuine gamble (off the engine's
   * pick, gave up a mistake-sized floor) that landed.
   */
  riskPaidOff?: boolean;
  /**
   * The played line and the safe line, each against the opponent's clicked reply, own perspective. Written when the payoff cleared
   * the margin and both cells are known; the credit needs the played cell to beat the safe cell by CLICK_EDGE_MIN. Absent where
   * there is no cell to compare (no matrix, a hidden doubles slot).
   */
  safeAgainstClick?: { against: string; playedValue: number; safeValue: number };
  /**
   * The flagged risk matches the opponent model's best response: phrased as a read against the opponent's tendencies; no grade reads it.
   */
  riskWasRead?: boolean;
  /**
   * A read on an untiered turn: the played choice carried no equilibrium weight, gave up some floor against the safe line, paid at
   * once and grew a mistake-sized edge within the window. Card sentence only: no riskPaidOff, so attribution, the report's read list
   * and totals stay unmoved. `payoff` is the window's best own outcome over the safe guarantee.
   */
  readCredit?: { payoff: number; payoffTurn?: number };
  /**
   * A slot's choice was never observed (flinch/sleep: the protocol shows `|cant|`): `played` is the best combo consistent with the
   * visible slots, so the regret is a charitable lower bound.
   */
  playedPartial?: boolean;
  /** A depth+1 verification pass cleared the shallow misplay flag. */
  verifiedAtDepth?: boolean;
  /** Verdict band for the regret, after leniency (absent = clean play). */
  tier?: VerdictTier;
  /**
   * The flagged turn fed a body deliberately (nearly dead, or healthy while the scores stayed at HEALTHY_SACK_FLOOR on both sides).
   * Graded as a sack: tier demoted one band, cleared for a stayed feed that repaid the full regret plus the margin (`verified`); never a
   * risk.
   */
  sacrifice?: SackInfo;
  /** How many options the engine ranked for this side; 1 marks a forced turn (or the waiting sentinel), which accuracy grading excludes. */
  choiceCount?: number;
  /**
   * The verdict hinges on a guessed item: under a usage-plausible alternative the regret lands in a softer band; `tier` is already the
   * most charitable probed band (acquit-only).
   */
  sensitivity?: { species: string; alternatives: { item: string; tier: VerdictTier | 'none' }[] };
  /**
   * How many ranked options sit within an inaccuracy of best: the side's decision breadth (both sides at BREADTH_MIN_OPTIONS make an open
   * turn).
   */
  viableCount?: number;
  /**
   * The equilibrium leans a different choice than the argmax-EV recommendation (weight at least CONDITIONAL_MIX_MIN), so the
   * recommendation renders conditionally. bestWhen/mixWhen name the opponent replies where each choice earns its keep (largest
   * own-perspective value difference in the solved matrix); null when no reply favors that side. Tiered turns only.
   */
  conditional?: { mixLabel: string; mixWeight: number; bestWhen: string | null; mixWhen: string | null };
  /**
   * The recommended best is mechanically null against the opposing active (Will-O-Wisp into a Fire-type). `alternative` is a
   * co-optimal option within the rank-tie epsilon that is not null itself, shown in its place (grading untouched); without one
   * the narrative keeps the true best and names the caveat.
   */
  bestNull?: { reason: string; alternative: { label: string; ev: number; koOdds?: KoOddsInfo } | null };
  /**
   * The equilibrium mix all but commits to one switch (at least FORCED_MIX_THRESHOLD, more than one option): a forced-sac or forced-pivot
   * expectation named in prose.
   */
  forcedMix?: { label: string; weight: number };
  /** A milestone streak of secondary fishing or crit accumulation ending on this turn; render-time narrative only. */
  streakOdds?: StreakOdds;
  /**
   * The own row that best answers the opponent's actual click, when it beats the played line in that column by a mistake-sized gain: the
   * shift narrative's concrete read that was on the table. Display-only; fails closed without machine choice ids or a known opponent
   * action.
   */
  hindsightRead?: {
    response: string; against: string; gain: number;
    /**
     * The played row's own-perspective value against the click (the gain is the best row's value minus this one); `walkedInto` reads it.
     */
    playedValue?: number;
    /**
     * The opponent model's share of the actual click, set when it was the model's favourite (at least LIKELIEST_CLICK_MIN): the read was
     * findable.
     */
    likeliest?: number;
    /**
     * The read clears the side row's gate: its gain lies a band (one inaccuracy) past the equilibrium regret, and the cells of the best
     * and the played row against the click are no guess (see `cellSolid`). `line` is the side row's sentence; neither enters tier or
     * sums.
     */
    shown?: true;
    line?: string;
    /**
     * The cell of the best row or of the played row against the click is a guess (see `cellSolid`): the card sentences leave the read
     * out, it stays on the analysis.
     */
    thin?: true;
  };
  /**
   * The KO odds the "True odds" note quotes for the played line (`played`) or the shown recommendation (`best`) price a hit that
   * never landed against the opponent's actual click: in that line's cell the search finds no uncertain hit of the claim's move
   * (the opponent's pair stops it: a Protect, a Wide Guard). Display only: the note leaves such a claim out (odds-stopped.ts).
   */
  hitStopped?: { played?: true; best?: true };
  /**
   * The read before the click: the opponent model's favourite `expect` holds at least PREDICTIVE_READ_CONFIDENCE, and against it
   * the own row `response` beats the displayed recommendation `over` by a mistake-sized `gain`. Needs the tendencies; display-only.
   */
  predictiveRead?: { expect: string; confidence: number; response: string; gain: number; over: string };
  /**
   * The turn brings in a mon the opponent has no live race answer to (root profile from the search): entering it cleanly is
   * profit, the opponent can only sacrifice into it. Set when the played or recommended line's entry target ("→ X", a pivot's
   * "U-turn → X" included) is on the own unanswered list; display-only. With `heldBy` the mon sits in the switch-in stage
   * instead: every bench answer dies on arrival and only the named standing active still holds the pair.
   */
  unanswered?: { species: string; heldBy?: string };
  /**
   * The board is practically decided for this side: one own mon clears the whole living enemy team in sequence and survives the
   * expected return fire (the search root's decided sweep). A board state, present on every decided turn; `announce` is true only
   * until the game report has spoken the sentence once (the per-turn card passes no seen-set and announces every decided turn).
   */
  decided?: { species: string; announce: boolean };
  /**
   * One high-odds click from decided: `odds` (accuracy × kill share) on the click that removes `removes`, after which the
   * sweeper clears the rest. `species` is the clicker, `click` the move as the played choice writes it.
   */
  nearDecided?: { species: string; odds: number; removes: string; click?: { move: string; target?: number }; announce: boolean };
  /**
   * A forced win proven from this root for this side (the sim played every reply out): `turns` the deepest proven line, `mass`
   * the proven share of the outcome classes, `caveat` what the class model leaves out. `announce`: see `decided`, key forcedWinSeenKey.
   */
  forcedWin?: Pick<ForcedWin, 'delay' | 'delayName' | 'choiceNames'> & { turns: number; mass: number; caveat: ForcedWinCaveat; open?: ForcedWinOpen; announce: boolean };
}

/** The spoken-once key of a game-report entry sentence: a mon's entry sentence speaks on its first entry only, and each stage (held, open) is its own statement. */
export const unansweredSeenKey = (side: 'p1' | 'p2', signal: { species: string; heldBy?: string }): string =>
  `${side}:${signal.species}:${signal.heldBy ? 'held' : 'open'}`;

/** The spoken-once key of a decided or near-decided announcement: each near stage (each removal target) is its own statement, the decided stage speaks once per side. */
export const decidedSeenKey = (side: 'p1' | 'p2', signal: { species: string; removes?: string }): string =>
  signal.removes ? `${side}:${signal.species}:near:${signal.removes}` : `${side}:decided`;

/** The spoken-once key of the forced-win sentence: once per side. */
export const forcedWinSeenKey = (side: 'p1' | 'p2'): string => `${side}:forced`;

/** Deep re-search of the played and best pairs (p1-perspective outcomes). */
interface VerifiedOutcomes {
  playedDeep: number;
  bestDeep: number;
}
/** Per-side deep re-search results for one flagged turn. */
export interface TurnVerification {
  p1?: VerifiedOutcomes;
  p2?: VerifiedOutcomes;
}

/** The analysis of one turn: the score movement, its attribution and both sides' records. */
export interface TurnAnalysis {
  turn: number;
  /**
   * The fainted share at this turn's start and, for the after score, at the next turn's start (echoes of the params): each score prints
   * at its own turn's share, as the graph does.
   */
  faintedFraction?: number;
  faintedFractionAfter?: number;
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
  /** False when played actions were never parsed (doubles): nothing may claim blame or "could not act". Absent means true. */
  playedTracking?: boolean;
  /**
   * The sides the turn's rolls favored (turn-analysis/luck.ts): a protocol dice marker, or a played line's KO odds as they came
   * out on the body they priced. The luck sentences say "rolled" only for a roll in the residual's direction. Absent without the
   * turn's protocol and without the planner's answer for the played cell: the sentences keep their ungated form.
   */
  rolledFor?: { p1: boolean; p2: boolean };
}

/** analyzeTurn's input: the sweep's cached per-turn data plus the render-time context. */
export interface AnalyzeTurnParams {
  turn: number;
  result: EvalResult;
  played: PlayedTurn | null;
  playedOutcome: number | null;
  /** Expected pair values of the following turns (p1 perspective): a read's payoff cashes in over PAYOFF_WINDOW turns. */
  futureOutcomes?: (number | null)[];
  /** Deep re-search of flagged turns: when the depth+1 pair values say the played line holds up, the misplay verdict is cleared. */
  verified?: TurnVerification | null;
  scoreBefore: number;
  scoreAfter: number | null;
  /** False = played actions unavailable (doubles); blame is off the table. */
  playedTracking?: boolean;
  /** Per-side low-HP sacrifices detected in the turn's protocol (played.ts). */
  sacks?: { p1?: SackInfo; p2?: SackInfo };
  /** The turn's dice markers and move hits (dice-events.ts detectRolls); absent keeps rolledFor off. */
  rolls?: TurnRolls | null;
  /** Per-side opponent-model best responses (opponent-model.ts computeRead). */
  reads?: { p1?: ReadRecommendation | null; p2?: ReadRecommendation | null };
  /**
   * Each player's own action tendencies from this replay (parseTendencies): the opponent model of the predictive read and the
   * likeliest-click note; absent keeps both out.
   */
  tendencies?: { p1: PlayerTendencies; p2: PlayerTendencies } | null;
  /** Per-side item-sensitivity probes for flagged turns; acquit-only: a probe can soften the verdict, never harshen it. */
  sensitivity?: TurnSensitivity | null;
  /**
   * Active species at turn start (singles: exactly one per side, else null) plus the replay generation: the null-move guard's
   * board context; absent or null species keep the guard off. The Tera types name what a terastallized active defends with.
   */
  actives?: {
    p1: string | null; p2: string | null; gen: number;
    /** The replay's mod (Champions), next to its generation: the Dex the analysis reads is the game's own. */
    mod?: RulesMod;
    p1Tera?: string | null; p2Tera?: string | null;
  } | null;
  /**
   * Per-side played-move history for the whole game (index t−1 = turn t, the current turn included): the streak detector's input,
   * render-time only.
   */
  playedHistory?: { p1: (StreakHistoryEntry | null)[]; p2: (StreakHistoryEntry | null)[] } | null;
  /**
   * Entry sentences the game report has already spoken, keyed by unansweredSeenKey; the per-turn card omits it and keeps the sentence on
   * every entry turn.
   */
  unansweredSeen?: ReadonlySet<string> | null;
  /**
   * Decided and near-decided announcements the game report has already spoken, keyed by decidedSeenKey; the signal state stays, only
   * `announce` flips off.
   */
  decidedSeen?: ReadonlySet<string> | null;
  /**
   * The fainted share of all bodies at turn start, the auto mode's phase measure. The near-decided sentence waits for
   * AUTO_MCTS_FAINTED_FRACTION: on full teams a one-roll sweep is a threat, not a near-won game. Absent or null keeps the gate off.
   */
  faintedFraction?: number | null;
  /** The share at the next turn's start, for the after score's percent text. */
  faintedFractionAfter?: number | null;
}
