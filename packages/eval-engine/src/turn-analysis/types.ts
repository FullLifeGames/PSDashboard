import type { EvalResult, ForcedWin, ForcedWinCaveat, ForcedWinOpen, KoOddsInfo, RankedChoice, ReadRecommendation } from '../types.ts';
import type { StreakHistoryEntry, StreakOdds } from '../streaks.ts';
import type { PlayedAction, PlayedTurn, SackInfo } from '../played.ts';
import type { TurnRolls } from '../dice-events.ts';
import type { RulesMod, SideId } from '@fulllifegames/replay-core';
import type { PlayerTendencies } from '../opponent-model.ts';

export type Side = SideId;

/** A verdict band on the EV-regret. */
export type VerdictTier = 'inaccuracy' | 'mistake' | 'blunder';
/** Regret thresholds of the verdict bands in wp-units (0.1 = 5% win probability). */
export const TIER_THRESHOLDS: Record<VerdictTier, number> = {
  inaccuracy: 0.1,
  mistake: 0.2,
  blunder: 0.4,
};
/** Own-perspective score (0.7 wp-units = 85% win probability) from which verdicts soften one tier. */
export const DECIDED_SCORE = 0.7;

/** Own-perspective score from which a healthy-body feed can read as a simplification sack, before and after it. */
export const HEALTHY_SACK_FLOOR = 0.4;

/** Regret (best − played, own perspective) that marks a decision problem: a mistake-sized one. */
export const REGRET_THRESHOLD = TIER_THRESHOLDS.mistake;
/** Residual swing (actual − expected outcome) that marks a chance swing: a mistake-sized one. */
export const CHANCE_THRESHOLD = TIER_THRESHOLDS.mistake;

/** Who or what moved a turn's score. */
export type TurnAttribution =
  | 'p1-decision' | 'p2-decision' | 'both-decision'
  /** A flagged risk whose read won real value: graded as a good play. */
  | 'p1-read' | 'p2-read' | 'both-read'
  | 'chance'
  /** A meaningful swing with no single culprit: decision and chance each stay under their thresholds. */
  | 'shift'
  | 'quiet' | 'unclear';

/** A risk pays off when the actual pair's value beats the safe line's floor by at least this much, own perspective. */
export const RISK_PAYOFF_MARGIN = TIER_THRESHOLDS.inaccuracy;

/** Noise tolerance under the payoff margin, for the paid-off credit only: it widens praise, never excuses. */
export const RISK_PAYOFF_EPSILON = 0.02;

/** How many future turns a read gets to cash in. */
export const PAYOFF_WINDOW = 3;

/** A stay-and-die feed's floor gate: the outcome may exceed the played line's priced floor by at most this much. */
export const FEED_FLOOR_EPSILON = 0.02;

/** Viable options (within an inaccuracy of best) both sides need before a culprit-free swing reads as an open turn. */
export const BREADTH_MIN_OPTIONS = 4;

/** A recommendation conflicts with the engine's play when the mix puts this much weight on another choice. */
export const CONDITIONAL_MIX_MIN = 0.5;

/** An equilibrium mix this concentrated on one switch reads as "effectively forced". */
export const FORCED_MIX_THRESHOLD = 0.85;

/** One re-evaluation of the flagged side's turn under another item on an opposing mon; EVs are own-perspective. */
export interface SensitivityProbe {
  species: string;
  item: string;
  playedEv: number;
  bestEv: number;
}

/** Per-side item-sensitivity probes for one turn. */
export interface TurnSensitivity {
  p1?: SensitivityProbe[];
  p2?: SensitivityProbe[];
}

/** One side's grading and narrative signals for one turn. */
export interface SideAnalysis {
  /** The fainted share this record was read at (an echo of the param); percent texts print at it, no grade reads it. */
  faintedFraction?: number;
  playedRaw: PlayedAction | null;
  setupMove?: string;
  /** The protocol's reason a chosen action never surfaced ('slp', 'flinch', 'faint'): the side did pick. */
  prevented?: string;
  /** KO'd before it acted: `played` is a charitable stand-in ("stayed in"); risk framing stays off. */
  neverActed?: boolean;
  /** Doubles: the per-slot actions this side actually took. */
  playedSlots?: (PlayedAction | null)[];
  played: RankedChoice | null;
  /** The top choice by equilibrium EV, the grading reference. */
  best: RankedChoice | null;
  /** The max-floor choice, "the engine's safe line". */
  safe: RankedChoice | null;
  /** best.ev − played.ev (own perspective), floored at 0. */
  regret: number | null;
  /** The regret's floor priced in a punisher the opponent did not click: a read that came true. */
  riskUnpunished?: boolean;
  /** Own-perspective value of the actual pair over the safe line's floor. */
  riskPayoff?: number;
  /** Turns AFTER this one until the payoff peaked (absent = immediate). */
  riskPayoffTurn?: number;
  /** The read won at least RISK_PAYOFF_MARGIN over the safe guarantee; also set for a gamble that landed. */
  riskPaidOff?: boolean;
  /**
   * The played and the safe line against the opponent's clicked reply, own perspective; absent where there is
   * no cell to compare (no matrix, a hidden doubles slot).
   */
  safeAgainstClick?: { against: string; playedValue: number; safeValue: number };
  /** The flagged risk matches the opponent model's best response: phrased as a read; no grade reads it. */
  riskWasRead?: boolean;
  /**
   * A read on an untiered turn that paid at once and grew a mistake-sized edge in the window; card sentence only.
   * `payoff` is the window's best own outcome over the safe guarantee.
   */
  readCredit?: { payoff: number; payoffTurn?: number };
  /** A slot's choice was never observed (`|cant|`): `played` is the best combo fitting the visible slots. */
  playedPartial?: boolean;
  /** A depth+1 verification pass cleared the shallow misplay flag. */
  verifiedAtDepth?: boolean;
  /** Verdict band for the regret, after leniency (absent = clean play). */
  tier?: VerdictTier;
  /**
   * The flagged turn fed a body deliberately: tier demoted one band, cleared for a stayed feed that repaid the
   * full regret plus the margin (`verified`); never a risk.
   */
  sacrifice?: SackInfo;
  /** Options the engine ranked for this side; 1 marks a forced turn (or the waiting sentinel), not graded. */
  choiceCount?: number;
  /** The verdict hinges on a guessed item: with another the regret lands softer; `tier` is that band. */
  sensitivity?: { species: string; alternatives: { item: string; tier: VerdictTier | 'none' }[] };
  /** Ranked options within an inaccuracy of best (both sides at BREADTH_MIN_OPTIONS make an open turn). */
  viableCount?: number;
  /**
   * The equilibrium leans another choice than the argmax-EV one (weight at least CONDITIONAL_MIX_MIN); tiered only.
   * bestWhen/mixWhen name the opponent replies where each choice earns its keep; null when no reply favors that side.
   */
  conditional?: { mixLabel: string; mixWeight: number; bestWhen: string | null; mixWhen: string | null };
  /**
   * The recommended best is mechanically null against the opposing active (Will-O-Wisp into a Fire-type);
   * `alternative` is a co-optimal non-null option shown in its place, grading untouched; else the narrative names it.
   */
  bestNull?: { reason: string; alternative: { label: string; ev: number; koOdds?: KoOddsInfo } | null };
  /** The equilibrium mix all but commits to one switch (at least FORCED_MIX_THRESHOLD, more than one option). */
  forcedMix?: { label: string; weight: number };
  /** A milestone streak of secondary or crit luck ending on this turn; render-time narrative only. */
  streakOdds?: StreakOdds;
  /**
   * The own row that best answers the opponent's actual click and beats the played line there by a mistake-sized gain.
   * Display-only; fails closed without machine choice ids or a known opponent action.
   */
  hindsightRead?: {
    response: string; against: string; gain: number;
    /** The played row's own-perspective value against the click (gain = best row's minus this). */
    playedValue?: number;
    /** The opponent model's share of the actual click, set when it was the favourite (at least LIKELIEST_CLICK_MIN). */
    likeliest?: number;
    /**
     * The read clears the side row's gate: gain a band past the equilibrium regret, no guessed cell (see `cellSolid`).
     * `line` is the side row's sentence; neither enters tier or sums.
     */
    shown?: true;
    line?: string;
    /** A cell against the click is a guess (see `cellSolid`): card sentences leave the read out. */
    thin?: true;
  };
  /**
   * The "True odds" note's KO odds for the played or shown line price a hit the opponent's click stopped
   * (a Protect, a Wide Guard); display only: the note leaves such a claim out (odds-stopped.ts).
   */
  hitStopped?: { played?: true; best?: true };
  /**
   * The read before the click: the model's favourite `expect` (at least PREDICTIVE_READ_CONFIDENCE) is beaten by
   * own row `response` over the displayed `over` by a mistake-sized `gain`. Needs the tendencies; display-only.
   */
  predictiveRead?: { expect: string; confidence: number; response: string; gain: number; over: string };
  /**
   * The turn brings in a mon the opponent has no live race answer to (the search's root profile); display-only.
   * With `heldBy` every bench answer dies on arrival and only the named standing active still holds the pair.
   */
  unanswered?: { species: string; heldBy?: string };
  /**
   * The board is practically decided for this side (the search root's decided sweep); present on every decided turn.
   * `announce` is true only until the game report has spoken the sentence once; the per-turn card announces every time.
   */
  decided?: { species: string; announce: boolean };
  /** One high-odds click from decided: `odds` (accuracy × kill share) on the click that removes `removes`. */
  nearDecided?: { species: string; odds: number; removes: string; click?: { move: string; target?: number }; announce: boolean };
  /**
   * A forced win proven from this root (the sim played every reply out): `turns` the deepest proven line, `mass` the
   * proven share of the outcome classes, `caveat` what the class model leaves out. `announce`: see `decided`.
   */
  forcedWin?: Pick<ForcedWin, 'delay' | 'delayName' | 'choiceNames'> & { turns: number; mass: number; caveat: ForcedWinCaveat; open?: ForcedWinOpen; announce: boolean };
}

/** The spoken-once key of a game-report entry sentence; each stage (held, open) is its own statement. */
export const unansweredSeenKey = (side: 'p1' | 'p2', signal: { species: string; heldBy?: string }): string =>
  `${side}:${signal.species}:${signal.heldBy ? 'held' : 'open'}`;

/** The spoken-once key of a decided or near-decided announcement; each near stage (removal target) is its own. */
export const decidedSeenKey = (side: 'p1' | 'p2', signal: { species: string; removes?: string }): string =>
  signal.removes ? `${side}:${signal.species}:near:${signal.removes}` : `${side}:decided`;

/** The spoken-once key of the forced-win sentence: once per side. */
export const forcedWinSeenKey = (side: 'p1' | 'p2'): string => `${side}:forced`;

interface VerifiedOutcomes {
  playedDeep: number;
  bestDeep: number;
}
/** Per-side deep re-search results for one flagged turn (p1-perspective outcomes). */
export interface TurnVerification {
  p1?: VerifiedOutcomes;
  p2?: VerifiedOutcomes;
}

/** The analysis of one turn: the score movement, its attribution and both sides' records. */
export interface TurnAnalysis {
  turn: number;
  /** The fainted share at this turn's start and, for the after score, at the next turn's (echoes of the params). */
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
  /** False when played actions were never parsed (doubles): no blame, no "could not act"; absent means true. */
  playedTracking?: boolean;
  /** The sides the turn's rolls favored (turn-analysis/luck.ts); absent without the turn's protocol or played cell. */
  rolledFor?: { p1: boolean; p2: boolean };
}

/** analyzeTurn's input: the sweep's cached per-turn data plus the render-time context. */
export interface AnalyzeTurnParams {
  turn: number;
  result: EvalResult;
  played: PlayedTurn | null;
  playedOutcome: number | null;
  /** Expected pair values of the following turns (p1 perspective); a read cashes in over PAYOFF_WINDOW turns. */
  futureOutcomes?: (number | null)[];
  /** Deep re-search of flagged turns: when the depth+1 values say the played line holds, the misplay is cleared. */
  verified?: TurnVerification | null;
  scoreBefore: number;
  scoreAfter: number | null;
  /** False = played actions unavailable (doubles). */
  playedTracking?: boolean;
  sacks?: { p1?: SackInfo; p2?: SackInfo };
  /** The turn's dice markers and move hits (detectRolls); absent keeps rolledFor off. */
  rolls?: TurnRolls | null;
  reads?: { p1?: ReadRecommendation | null; p2?: ReadRecommendation | null };
  /** Each player's action tendencies from this replay (parseTendencies); absent keeps the predictive read out. */
  tendencies?: { p1: PlayerTendencies; p2: PlayerTendencies } | null;
  /** Item-sensitivity probes for flagged turns; acquit-only: a probe can soften the verdict, never harshen it. */
  sensitivity?: TurnSensitivity | null;
  /**
   * Active species at turn start (singles: exactly one per side, else null) plus the replay generation: the
   * null-move guard's board context; absent or null species keep the guard off.
   */
  actives?: {
    p1: string | null; p2: string | null; gen: number;
    /** The replay's mod (Champions): the Dex the analysis reads is the game's own. */
    mod?: RulesMod;
    p1Tera?: string | null; p2Tera?: string | null;
  } | null;
  /** Per-side played-move history for the whole game (index t−1 = turn t, current turn included); render-time only. */
  playedHistory?: { p1: (StreakHistoryEntry | null)[]; p2: (StreakHistoryEntry | null)[] } | null;
  /** Entry sentences the game report has already spoken, keyed by unansweredSeenKey; the per-turn card omits it. */
  unansweredSeen?: ReadonlySet<string> | null;
  /** Announcements the game report has already spoken, keyed by decidedSeenKey; only `announce` flips off. */
  decidedSeen?: ReadonlySet<string> | null;
  /**
   * The fainted share of all bodies at turn start, the auto mode's phase measure; the near-decided sentence waits for
   * AUTO_MCTS_FAINTED_FRACTION. Absent or null keeps the gate off.
   */
  faintedFraction?: number | null;
  faintedFractionAfter?: number | null;
}
