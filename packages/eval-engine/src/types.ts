import type { BranchSlotChoice } from './branch-choices.ts';
import type { EvalCellJob, EvalCellValue, EvalChoiceOption, EvalChoicesInfo, EvalSubSearchJob } from './executor-types.ts';
import type { ForcedDie } from './dice/types.ts';
import type { OnRequestJob, OnRequestResult, OnRequestStep } from './on-request.ts';
import type { PlayedAction, PlayedBounds, PlayedTurn } from './played.ts';
import type { SimFastLever, SimFastReport } from './forward/sim-fast/state.ts';
import type { SearchBudget } from './search/budget.ts';
import type { StaticRuleset } from './score/weights.ts';

/** Which Pokémon may Terastallize in the search: all or none, or per-side species allow-lists (draft leagues). */
export type TeraAllowance = boolean | { p1: string[]; p2: string[] };

/** Engine settings sent to the worker. */
export interface EvalSettings {
  /** Turns ahead. 1 = full joint matrix only. */
  depth: 1 | 2 | 3;
  samples: 1 | 3 | 5;
  /** Terastallize enumeration (default true = everyone). */
  tera?: TeraAllowance;
  /**
   * Sleep Clause applies to this replay (a custom-game reconstruction loses its @@@ rule suffix, so the simulator
   * cannot say); redundant sleep moves drop from the candidate lists.
   */
  sleepClause?: boolean;
  mode?: 'matrix' | 'mcts';
  /**
   * Sweep hint (root only): the actions played this turn; the doubles candidate restriction keeps the matching option.
   * Singles carries them in p1 / p2 (option lists ignore them).
   */
  keepPlayed?: {
    p1?: PlayedAction | null;
    p2?: PlayedAction | null;
    p1Slots?: (PlayedAction | null)[];
    p2Slots?: (PlayedAction | null)[];
    /** The marks of bodies that fell before they acted (`PlayedTurn.fell`), shipped as `EvalResult.playedBounds`. */
    fell?: PlayedTurn['fell'];
  } | null;
  /** false skips the forced-win prover after the root search (the graph sweep's sketch pass). */
  prove?: boolean;
  /** The rows whose lines the search replays as the engine's lines, by label per side; absent: the best rows. */
  lineRows?: { p1?: string[]; p2?: string[] };
  /** The answers the host's card ranks first, by the side whose lines they are (`p1`: player 2's labels). */
  lineReplies?: { p1?: string[]; p2?: string[] };
  /**
   * Extra tree iterations per tree, run once result and ranking are final, aimed at the rows whose lines the card
   * shows. They never write the root's statistics, so no score, rank or grade moves. Absent or 0: no pass.
   */
  linePass?: number;
  /**
   * The rule set the replay runs under (Pokémon Champions or standard), named by the host from the format: the
   * simulator reconstructs every doubles game as Doubles OU and knows no Champions format. Absent means standard.
   */
  ruleset?: StaticRuleset;
}

/** The auto mode's switch point: matrix search below this fainted fraction, the DUCT tree at or above it. */
export const AUTO_MCTS_FAINTED_FRACTION = 0.25;

/** Panel preferences persisted in localStorage (worker only sees EvalSettings). */
export interface EvalPreferences {
  depth: 1 | 2;
  samples: 1 | 3 | 5;
  /**
   * 'mcts' ignores depth/samples; 'auto' routes per turn on the fainted fraction (AUTO_MCTS_FAINTED_FRACTION).
   * Resolved before dispatch: EvalSettings and stored per-turn results only carry 'matrix' or 'mcts'.
   */
  mode: 'matrix' | 'mcts' | 'auto';
  /** Re-run automatically after each executed branch turn. */
  auto: boolean;
  /** Analyze game starts when a replay loads, and fresh variation positions evaluate without the Evaluate button. */
  autoAnalyze: boolean;
  /**
   * The opponent answers each move the user plays with the reply that hurts it most (`worstAnswer`). App only:
   * no search setting, score, grade or report reads it. Absent: off.
   */
  hardMode?: boolean;
  /**
   * Tera enumeration: 'auto' = only when the replay terastallized (in draft/custom formats, only the Pokémon that did);
   * 'revealed' forces the per-Pokémon restriction for any format.
   */
  tera: 'auto' | 'on' | 'off' | 'revealed';
}

/** Analytic one-turn odds of an option's damaging move on the opposing active: accuracy × crit-weighted KO share. */
export interface KoOddsInfo {
  accuracy: number;
  killFraction: number;
  /** Doubles: the slot's move and target the odds belong to, "Play Rough→Incineroar". Singles leaves it unset. */
  label?: string;
  /** The slot and species of the attacker that makes the odds (singles: slot 0). */
  attacker?: { slot: number; species: string };
}

/** One outcome class of a blended boundary cell. */
export interface CellBlendClass {
  /** The fold's class key (cell-blend.ts): 'miss', 'hit-kill', 'hit-nokill', or two sides joined with '|'. */
  key: string;
  /** Analytic weight (normalized over the classes that were sampled). */
  weight: number;
  leafSum: number;
  count: number;
  /** The first-seed child (the one deepening expands) lives in this class. */
  hasFirst: boolean;
  /** Every sampled child of this class ended the game (its leaves are exact: 1, -1 or 0). */
  ended: boolean;
  /** The class's representative child one ply deeper; set by the verify step on every open class. */
  deepened?: number;
}

/** A root boundary cell's analytic class blend; deepening re-blends through it (reblendValue), not with one branch. */
export interface CellBlend {
  classes: CellBlendClass[];
  firstLeaf: number;
}

export interface CellDraw {
  /** The slot of the draw's seed in `cellSeeds`. */
  index: number;
  /** In a speed-tied singles cell, the scripted move order. */
  first?: 'p1' | 'p2';
}

/** Diagnostic: a boundary cell with analytic outcome classes unobserved within the probe budget; it renormalizes. */
export interface KoOddsMismatch {
  i: number;
  j: number;
  p1Choice: string;
  p2Choice: string;
  missing: string[];
  analytic: Record<string, number>;
  sampled: Record<string, number>;
}

/** One ranked option for a side; values are from that side's OWN perspective (p2's are negated p1 matrix values). */
export interface RankedChoice {
  /** Sim choice string: "move seismictoss", "move dracometeor terastallize", "switch 3". */
  choice: string;
  label: string;
  /** Value after the opponent's most punishing reply: the floor. */
  worstCase: number;
  expected: number;
  /** Expected value against the OPPONENT's equilibrium mixture (own perspective), the primary grading reference. */
  ev: number;
  /** Label of the opponent reply that achieves worstCase; null when the opponent has no choices. */
  punishedBy: string | null;
  /** Principal variation after the punishing reply, one best pair of labels per turn; only where depth ≥ 2 expanded. */
  line?: { p1: string; p2: string }[];
  /** Analytic kill odds of this option's move vs the pre-turn opposing active; only if 0 < killFraction < 1. */
  koOdds?: KoOddsInfo;
}

/** The result of one search: the score, each side's ranking and the evidence behind them. */
export interface EvalResult {
  /** [-1, +1] from p1's perspective: the solved game value (clamped into the maximin interval); else the midpoint. */
  score: number;
  /** Solved value of the root matrix game (p1 perspective), when a full matrix exists. */
  gameValue?: number;
  /** Width of the [v1, v2] interval the true game value lies in: near 0 a stable line exists, wide a toss-up. */
  interval: number;
  depthCompleted: number;
  perSide: { p1: RankedChoice[]; p2: RankedChoice[] };
  /** The solved root matrix (≤ 16×16, wp-units, p1 perspective) with the equilibrium mixes, for the Read lens. */
  matrix?: EvalMatrix;
  /** Boundary cells whose analytic classes went unsampled within the probe budget (advisory; cells renormalize). */
  koDiagnostics?: KoOddsMismatch[];
  /** Root-position mons the OTHER side has no live race answer to (per side, species); absent when empty. */
  unanswered?: UnansweredProfile;
  /**
   * Per side and slot, the moves (and the switch) a body that fell before it acted cannot have chosen
   * (`branch/action-bound.ts`); grading drops them before it matches a hidden slot. Absent when no body fell.
   */
  playedBounds?: PlayedBounds;
  /** The forced win proven from this root at or above MIN_FORCED_MASS; the score already carries its bar. */
  forcedWin?: ForcedWin;
  /** The engine that answered, when another one than this package's own search (the engine protocol, ENGINES.md). */
  engine?: { id: string; name: string; version?: string };
  /** The answer of a trend probe (EvalSubSearchJob.draw): this result's score minus the draw's child leaf. */
  trend?: number;
  /**
   * The lines over the next turns, from the tree search: per side its best row's and played row's line, each with
   * every die at its likeliest result. Absent on a matrix search or an engine that sends none. No grade reads it.
   */
  lines?: EvalLine[];
  /** The extra iterations per tree (`EvalSettings.linePass`) that made `lines`, written by the host; unread here. */
  linePass?: number;
}

/** One die a line names: the chance of its result (absent when the draw names none), `shown` if it could differ. */
export interface LineDie { die: ForcedDie; chance?: number; shown: boolean; ko?: { rolls: number; of: number } }

/** One side's click of a step: the engine's choice string and label, and the slot choices the branch layer replays. */
export interface LineChoice { choice: string; label: string; slots: (BranchSlotChoice | null)[] }

/** One step of a line: a turn, or a replacement after a faint or a pivot (`replacement` names who picks). */
export interface LineStep { p1: LineChoice; p2: LineChoice; replacement?: 'p1' | 'p2' | 'both'; dice: LineDie[] }

/** The line of one row; `for` says which of the turn's two lines it is (one line carries both when the rows agree). */
export interface EvalLine {
  side: 'p1' | 'p2';
  label: string;
  choice: string;
  for: ('engine' | 'played')[];
  steps: LineStep[];
  /** The static evaluation after the last step from `side`'s view (the value space of `RankedChoice.worstCase`). */
  end: number;
  endFainted: number;
  visits: number;
  /** `worst`: the line of this row against the reply that hurts it most (`worstAnswer`); absent: the usual line. */
  versus?: 'worst';
  /** Why the line stops short of the tree's own: a step no longer legal after the likeliest dice. */
  cut?: string;
  /** The side (or both) that must send a body in after the last step: a choice the tree did not make. */
  awaits?: 'p1' | 'p2' | 'both';
  /** What the replay left to the stream (a die the draw cannot name, a draw no die names): the seed decides there. */
  unforced?: string[];
}

/** One step of a row's line as a tree carries it: both sides' choices by label and the visits of its cell. */
export interface TreeLineStep { p1: string; p2: string; visits: number }

/** A tree's lines per root row, by side and label (up to three, its own first); `floor`: through the floor answer. */
export interface RowLines { p1: Record<string, TreeLineStep[][]>; p2: Record<string, TreeLineStep[][]>; floor?: { p1: Record<string, TreeLineStep[]>; p2: Record<string, TreeLineStep[]> } }

/** One line to replay: the row, the trees' lines for it best first (the next stands in when one is cut). */
export interface LineRequest { side: 'p1' | 'p2'; label: string; for: ('engine' | 'played')[]; donors: TreeLineStep[][]; visits: number; versus?: 'worst' }

/** The lines job: the requests, and the settings the root's options need to resolve the first labels. */
export interface LinesInput { requests: LineRequest[]; tera?: TeraAllowance; sleepClause?: boolean; keepPlayed?: EvalSettings['keepPlayed'] }

/** A switch-in-stage row: every BENCHED enemy loses the entry race to this mon; the standing active still holds. */
export interface EntryUnanswered {
  species: string;
  heldBy: string;
}

/** One mon clears the WHOLE living enemy team in sequence and survives the return fire; no score reads it. */
export interface DecidedSweep {
  side: 'p1' | 'p2';
  species: string;
}

/** One high-odds click from decided: a boundary event at the near threshold removes the enemy active. */
export interface NearDecidedSweep {
  side: 'p1' | 'p2';
  species: string;
  /** accuracy × kill share of the unlocking click (≥ NEAR_DECIDED_ODDS). */
  odds: number;
  removes: string;
  /** The click's move id and, in doubles, the target's location, as a played choice writes them. */
  click?: { move: string; target?: number };
}

/** What the proof leaves open: nothing, barring a crit, or on sampled damage rolls. */
export type ForcedWinCaveat = 'none' | 'barring-crit' | 'sampled-rolls';

/** The heaviest open outcome class of the proven root cell, for the sentence (own side's event only). */
export interface ForcedWinOpen {
  side: 'p1' | 'p2';
  moveId: string;
  label: string;
  /** Analytic share of the proven outcome of this event (0.95 = the hit lands). */
  odds: number;
  /** 'hit' when the open class is a miss, 'kill' when it is a survived hit. */
  kind: 'hit' | 'kill';
}

/** A forced win proven in the sim from the root: one own line against every reply, per outcome class. */
export interface ForcedWin {
  side: 'p1' | 'p2';
  turns: number;
  /** The proven share of the outcome classes (a lower bound under the class model, caveat named). */
  mass: number;
  caveat: ForcedWinCaveat;
  /** The id of the stalling move whose repeats the proof delays (a foe that Protects again only postpones). */
  delay?: string;
  /** The root choice that proves the win, when the search's own list does not hold it (a sure strike). */
  choice?: string;
  /** The Dex names the card prints for `delay` ("Protect") and `choice` (the first striker, in doubles its partner). */
  delayName?: string; choiceNames?: { first: string; partner?: string };
  open?: ForcedWinOpen;
  engineScore: number;
  states: number;
}

/** The endgame scope: at most this many living bodies on the board. */
export const ENDGAME_MAX_BODIES = 3;
/** Proofs below this mass change nothing; one at exactly this mass (a coin flip) stays on the result without a bar. */
export const MIN_FORCED_MASS = 0.5;
/** Outside the small endgame the prover runs only when the search already reads the board at this score or beyond. */
export const PROVER_SCORE_FLOOR = 0.6;
/** Proofs at or above this mass are spoken. */
export const SPOKEN_MASS = 0.9;

/** What the prover needs from a finished search (main-thread safe). */
export interface ForcedWinInput {
  score: number;
  unanswered?: UnansweredProfile;
  rootOrder: { p1: string[]; p2: string[] };
  tera?: TeraAllowance;
  sleepClause?: boolean;
  ruleset?: StaticRuleset;
}

/** The prover's answer; `delay`, `choice` and their names are `ForcedWin`'s optional fields, handed on unchanged. */
export interface ForcedWinProof extends Pick<ForcedWin, 'delay' | 'choice' | 'delayName' | 'choiceNames'> {
  mass: number;
  turns: number;
  caveat: ForcedWinCaveat;
  open?: ForcedWinOpen;
  /** p1-perspective static of the open root children, share-weighted; null without open root children. */
  openValue: number | null;
  states: number;
  cells: number;
}

/** The side a proof is for, and the proof. */
export interface ForcedWinOutcome { side: 'p1' | 'p2'; proof: ForcedWinProof }

/** Root unanswered-mon profile: mons no living enemy answers at all, plus the entry lists (bench exhausted). */
export interface UnansweredProfile {
  p1: string[];
  p2: string[];
  p1Entry?: EntryUnanswered[];
  p2Entry?: EntryUnanswered[];
  /** Present only when exactly one side sweeps. */
  decided?: DecidedSweep;
  /** Present only when no decided sweep stands and exactly one side is a roll away. */
  nearDecided?: NearDecidedSweep;
}

/** The solved root matrix: labels, p1-perspective values and the equilibrium mixes. */
export interface EvalMatrix {
  p1Labels: string[];
  p2Labels: string[];
  /** Machine-readable choice ids aligned with the label arrays: the Read lens matches on these, never on labels. */
  p1Choices?: string[];
  p2Choices?: string[];
  /** values[i][j]: p1-perspective wp-unit value of (p1Labels[i], p2Labels[j]). */
  values: number[][];
  /** Equilibrium average strategies, index-aligned with the label arrays. */
  mixes: { p1: number[]; p2: number[] };
  /**
   * What stands behind each cell of `values` (same indices): the tree visits pooled over the cell, and whether the
   * verify step re-priced it. A doubles result carries `plan` and `classes` for the played row and column only.
   */
  cells?: MatrixCell[][];
}

/** What planCellEvents says about a root cell: a deterministic pair, a priced roll, a guard tripped. */
export type CellPlanKind = 'none' | 'events' | 'fail';

/** One outcome class of a rolled cell (`miss`, `hit-kill`, `hit-nokill|hit-kill`) with its analytic weight. */
export interface CellOutcomeClass { key: string; weight: number }

/** What stands behind one cell of `EvalMatrix.values`. */
export interface MatrixCell {
  visits: number;
  verified: boolean;
  plan?: CellPlanKind;
  classes?: CellOutcomeClass[];
}

/** A root cell the planner answered for ('fail' cells are not listed): every singles cell, the doubles played cells. */
export interface PlannedCell { key: number; plan: 'none' | 'events'; classes?: CellOutcomeClass[] }

/** An exploitative recommendation: best response to the opponent MODEL. */
export interface ReadRecommendation {
  /** choiceId is the machine id ('move recover', 'switch 3'); absent on cached reads without ids. */
  choice: { label: string; ev: number; worstCase: number; choiceId?: string };
  /** Own-perspective EV against the model (wp-units). */
  net: number;
  /** The model's top opponent probability; reads only surface when confident. */
  confidence: number;
  breakdown: { label: string; prob: number; value: number }[];
}

/** The worker's progress report: `done` of `total` at the depth being searched. */
export interface SearchProgress {
  done: number;
  total: number;
  depth: number;
}

export type { EvalCellJob, EvalCellValue, EvalChoiceOption, EvalChoicesInfo, EvalSubSearchJob } from './executor-types.ts';

/** One MCTS tree's root statistics, mergeable across parallel trees. */
export interface MctsTreeStats {
  p1Options: EvalChoiceOption[];
  p2Options: EvalChoiceOption[];
  p1N: number[];
  p1W: number[];
  p2N: number[];
  p2W: number[];
  visits: number;
  depth: number;
  /** Root static (p1 perspective), the unexpanded-cell fallback. */
  rootValue: number;
  /** The living Pokémon of each side at the root (mcts-merge.ts: VERIFY_ENDGAME_LIVING, VERIFY_DEPTH_FLOOR). */
  living?: { p1: number; p2: number };
  /** Per-option kill odds at the root (index-aligned with the option lists; absent for dead roots). */
  koOdds?: { p1: (KoOddsInfo | null)[]; p2: (KoOddsInfo | null)[] };
  /** Root cells with a priceable boundary event (planCellEvents kind 'events'); they drive the verify sampler. */
  boundaryCells?: number[];
  /**
   * The planner's answer per singles root cell (a missing cell failed), shipped by the offset-0 tree into
   * EvalMatrix.cells. A doubles root ships it for the played row and column when the search got keepPlayed.
   */
  plannedCells?: PlannedCell[];
  /** Every legal choice of each side at a doubles root, shipped by the offset-0 tree only; absent for singles. */
  p1Legal?: EvalChoiceOption[];
  p2Legal?: EvalChoiceOption[];
  /** Root-cell stats for the merged ranking: `total` sums the leaf values through the cell, `value` is the prior. */
  cells: {
    key: number; visits: number; total: number; value: number; ended: boolean;
    /** The drawn child's outcome class on a boundary cell, when recognized: the merge pools trees per class. */
    classKey?: string;
    /** The plan's chance of the drawn class (half of the Dex weight in a tied singles cell). */
    classWeight?: number;
  }[];
  /** This tree's own ranked result (PV/punisher donor for the merge). */
  result: EvalResult;
  rowLines?: RowLines;
}

interface SimFastStamp { simFast?: readonly SimFastLever[]; searchBudget?: SearchBudget }
interface RulesetStamp { ruleset?: StaticRuleset }

/** A message to the engine worker. */
export type EvalWorkerRequest = (
  | { type: 'search'; id: number; serializedBattle: string; settings: EvalSettings }
  | { type: 'mctstree'; id: number; serializedBattle: string; settings: EvalSettings; seedOffset: number; partials?: true }
  | { type: 'choices'; id: number; serializedBattle: string; tera: TeraAllowance; keepPlayed?: EvalSettings['keepPlayed']; sleepClause?: boolean }
  | { type: 'cells'; id: number; serializedBattle: string; jobs: EvalCellJob[] }
  | { type: 'subsearch'; id: number; serializedBattle: string; job: EvalSubSearchJob }
  | { type: 'prove'; id: number; serializedBattle: string; input: ForcedWinInput }
  | { type: 'lines'; id: number; serializedBattle: string; input: LinesInput }
  | { type: 'job'; id: number; serializedBattle: string; job: OnRequestJob }
) & SimFastStamp & RulesetStamp;

/** Final answers carry the worker's speed-layer status and its counters since the last one. */
export type EvalWorkerResponse = (
  | { type: 'progress'; id: number; progress: SearchProgress }
  | { type: 'partial'; id: number; result: EvalResult }
  | { type: 'result'; id: number; result: EvalResult }
  | { type: 'mctsTreeResult'; id: number; tree: MctsTreeStats }
  | { type: 'choicesResult'; id: number; info: EvalChoicesInfo }
  | { type: 'cellsResult'; id: number; values: EvalCellValue[] }
  | { type: 'proveResult'; id: number; outcome: ForcedWinOutcome | null }
  | { type: 'linesResult'; id: number; lines: EvalLine[] }
  | { type: 'jobStep'; id: number; step: OnRequestStep }
  | { type: 'jobResult'; id: number; result: OnRequestResult }
  | { type: 'error'; id: number; message: string }
) & { simFast?: SimFastReport };
