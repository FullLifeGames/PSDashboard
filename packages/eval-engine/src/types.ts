import type { PlayedAction } from './played.ts';

/**
 * Which Pokémon may Terastallize in the search: a global switch, or per-side
 * species allow-lists — draft leagues grant Tera rights per Pokémon, so a
 * boolean would invent threats (and recommendations) that are illegal there.
 */
export type TeraAllowance = boolean | { p1: string[]; p2: string[] };

/** Engine settings sent to the worker. */
export interface EvalSettings {
  /** Turns ahead. 1 = full joint matrix only. */
  depth: 1 | 2 | 3;
  /** Number of fixed PRNG seeds averaged per matrix cell. */
  samples: 1 | 3 | 5;
  /** Terastallize enumeration (default true = everyone). */
  tera?: TeraAllowance;
  /**
   * Sleep Clause is enforced for this replay (custom-game reconstructions
   * lose their @@@ rule suffix in serialization, so the sim can't say) —
   * redundant sleep moves drop from candidate lists.
   */
  sleepClause?: boolean;
  /** 'mcts' runs the DUCT tree search instead of the fixed-depth matrix. */
  mode?: 'matrix' | 'mcts';
  /**
   * Sweep hint (root only): the actions actually played this turn. The
   * doubles candidate restriction keeps the matching combined option ranked
   * so played-vs-best regret stays computable.
   */
  keepPlayed?: { p1Slots?: (PlayedAction | null)[]; p2Slots?: (PlayedAction | null)[] } | null;
}

/**
 * The auto engine mode's switch point: matrix search below this fainted
 * fraction, the DUCT tree at or above it (for full 6v6 boards: from the
 * third faint). Grid-tuned 2026-08-11 on the grand 826-position bed with
 * per-stratum robustness: the 0.00–0.25 plateau wins overall (+0.7 sign,
 * −0.002 brier vs the original 0.40) and 0.25 keeps the matrix side — and
 * with it verification, sensitivity probes, and the think-deeper ladder —
 * through the opening while mid (+3.3 ladder) and doubles (+2.5 ladder)
 * take the tree's stronger reading. Lives here (not search.ts) so the UI
 * layer can import it without pulling @pkmn/sim into the main chunk.
 */
export const AUTO_MCTS_FAINTED_FRACTION = 0.25;

/** Panel preferences persisted in localStorage (worker only sees EvalSettings). */
export interface EvalPreferences {
  /** UI offers 1/2 only — depth 3 costs 3-4× for capped gains (MCTS is the "deeper" mode). */
  depth: 1 | 2;
  samples: 1 | 3 | 5;
  /**
   * 'mcts' runs the DUCT tree search; depth/samples then don't apply.
   * 'auto' routes per turn on the position's fainted fraction — matrix
   * (at the configured depth/samples) while boards are full, MCTS once
   * bodies fall (AUTO_MCTS_FAINTED_FRACTION). Resolved to a concrete
   * engine BEFORE dispatch: EvalSettings and stored per-turn results only
   * ever carry 'matrix' or 'mcts'.
   */
  mode: 'matrix' | 'mcts' | 'auto';
  /** Re-run automatically after each executed branch turn. */
  auto: boolean;
  /**
   * Evaluation as an always-on companion: Analyze game starts by itself when
   * a replay loads, and fresh variation positions evaluate without the
   * Evaluate button. Persisted — switching it on once keeps it on.
   */
  autoAnalyze: boolean;
  /**
   * Tera enumeration: 'auto' = only when the replay terastallized (and in
   * draft/custom formats, only the Pokémon that did); 'revealed' forces the
   * per-Pokémon restriction for any format.
   */
  tera: 'auto' | 'on' | 'off' | 'revealed';
}

/**
 * Analytic one-turn odds of an option's own damaging move against the
 * standing opposing active (round 6 expectation grounding): accuracy after
 * stage/weather modifiers × the crit-weighted share of damage rolls that KO.
 */
export interface KoOddsInfo {
  accuracy: number;
  killFraction: number;
}

/** One outcome class of a blended boundary cell (round 6). */
export interface CellBlendClass {
  /** The fold's class key (cell-blend.ts): 'miss', 'hit-kill', 'hit-nokill', or two sides joined with '|' ('hit-kill|none'). */
  key: string;
  /** Analytic weight (normalized over the classes that were sampled). */
  weight: number;
  /** Sum of the sampled children's leaf values in this class. */
  leafSum: number;
  /** Number of sampled children in this class. */
  count: number;
  /** The first-seed child (the one deepening expands) lives in this class. */
  hasFirst: boolean;
  /** Every sampled child of this class ended the game (its leaves are exact +-1). */
  ended: boolean;
}

/**
 * A root boundary cell's analytic class blend. Deepening re-blends through
 * it (reblendValue) instead of overwriting the mixture with one branch.
 */
export interface CellBlend {
  classes: CellBlendClass[];
  /** The first-seed child's leaf value (swapped out on deepening). */
  firstLeaf: number;
}

/**
 * Diagnostic: a boundary cell whose analytic outcome classes were not all
 * observed within the probe budget. The cell renormalizes over the found
 * classes instead of inventing values; the harness counts these.
 */
export interface KoOddsMismatch {
  i: number;
  j: number;
  p1Choice: string;
  p2Choice: string;
  /** Class keys with analytic weight but no sampled representative after the probe budget. */
  missing: string[];
  analytic: Record<string, number>;
  sampled: Record<string, number>;
}

/**
 * One ranked option for a side. Values are from that side's OWN perspective
 * (p2 values are negated from the internal p1-perspective matrix).
 */
export interface RankedChoice {
  /** Sim choice string, e.g. "move seismictoss", "move dracometeor terastallize", "switch 3". */
  choice: string;
  /** Display label, e.g. "Seismic Toss", "Tera + Draco Meteor", "→ Dragapult". */
  label: string;
  /** Value after the opponent's best (most punishing) reply — the floor. */
  worstCase: number;
  /** Mean value over all opponent replies. */
  expected: number;
  /**
   * Expected value against the OPPONENT's equilibrium mixture (own
   * perspective) — the primary grading reference. Choices in the
   * equilibrium's support score ≈ the game value; dominated choices score
   * below it. MCTS results solve the same equilibrium over tree-informed
   * cells (2026-08-11) — ev semantics are engine-independent.
   */
  ev: number;
  /** Label of the opponent reply achieving worstCase; null when the opponent has no choices. */
  punishedBy: string | null;
  /**
   * Principal variation after the punishing reply: each step is the next
   * turn's best pair of labels. Present only on choices the deepening search
   * expanded (depth ≥ 2).
   */
  line?: { p1: string; p2: string }[];
  /**
   * Analytic kill odds of this option's own move vs the opposing pre-turn
   * active — present only when a real boundary event exists (killFraction
   * > 0, not a guaranteed kill). Cache-borne so narrative layers can quote
   * true odds without re-computation.
   */
  koOdds?: KoOddsInfo;
}

export interface EvalResult {
  /**
   * [-1, +1] from p1's perspective. Full-matrix searches score at the solved
   * game value (clamped into the maximin interval); pruned sub-searches and
   * MCTS keep the guarantee midpoint.
   */
  score: number;
  /** Solved value of the root matrix game (p1 perspective), when a full matrix exists. */
  gameValue?: number;
  /**
   * Width of the [v1, v2] interval the true game value lies in. Near 0 = a
   * stable line exists; wide = the turn hinges on out-predicting the
   * opponent (a genuine toss-up).
   */
  interval: number;
  depthCompleted: number;
  perSide: { p1: RankedChoice[]; p2: RankedChoice[] };
  /**
   * The solved root matrix (≤ 16×16, wp-units, p1 perspective) with the
   * equilibrium mixes — carried on the result so the opponent-model Read
   * lens can best-respond later without re-searching (cached results too).
   */
  matrix?: EvalMatrix;
  /**
   * Boundary cells whose analytic classes went unsampled within the probe
   * budget (advisory — the cells renormalized instead of inventing values).
   * The feedback harness counts these per replay.
   */
  koDiagnostics?: KoOddsMismatch[];
  /**
   * Root-position mons the OTHER side has no live race answer to (round 13,
   * per side, species names) — narrative input for the entry-is-profit
   * principle (648453 t13). Absent when empty or on sub-searches.
   */
  unanswered?: UnansweredProfile;
  /** Round 35: the forced win proven from this root, when one stands at or above MIN_FORCED_MASS; the score already carries its bar. */
  forcedWin?: ForcedWin;
}

/**
 * One switch-in-stage row (round 14): every BENCHED enemy loses the entry
 * race to this mon, while the named standing active still holds the pair —
 * the expert's "no remaining switch-ins" state (648453 t13: Lopunny-Mega
 * held only by the standing Tornadus-T; the bench can only sacrifice).
 */
export interface EntryUnanswered {
  species: string;
  /** Species of the standing active that still wins (or holds) the pair. */
  heldBy: string;
}

/**
 * Root unanswered-mon profile. `p1`/`p2` list mons no living enemy answers
 * at all (round 13); the optional entry lists carry the weaker round-14
 * stage — bench exhausted, active still holding. Entry lists are present
 * only when non-empty, so round-13 cache entries and pins read unchanged.
 */
/**
 * Round 15: the board says the game is practically over — one mon clears
 * the WHOLE living enemy team in sequence and survives the accumulated
 * expected return fire, and the other side has no such mon. Pairwise
 * unanswered is a threat; this is stronger (648453 t13: Lopunny wins every
 * fresh pair yet dies to the series). Narrative/display input only — the
 * score path never reads it.
 */
export interface DecidedSweep {
  side: 'p1' | 'p2';
  species: string;
}

/**
 * Round 15: one high-odds click from decided — a boundary event against
 * the standing enemy active (accuracy × kill share, round 6) at or above
 * the near threshold removes it and the REST clears in sequence (573756
 * t73: a 95% Fire Fang away from the sweep).
 */
export interface NearDecidedSweep {
  side: 'p1' | 'p2';
  species: string;
  /** accuracy × kill share of the unlocking click (≥ NEAR_DECIDED_ODDS). */
  odds: number;
  /** Species of the standing enemy active the click removes. */
  removes: string;
}

export type ForcedWinCaveat = 'none' | 'barring-crit' | 'sampled-rolls';

/** The heaviest open outcome class of the proven root cell, for the sentence (own side's event only). */
export interface ForcedWinOpen {
  side: 'p1' | 'p2';
  moveId: string;
  /** Display name of the move ("Fire Fang"). */
  label: string;
  /** Analytic share of the proven outcome of this event (0.95 = the hit lands). */
  odds: number;
  /** 'hit' when the open class is a miss, 'kill' when it is a survived hit. */
  kind: 'hit' | 'kill';
}

/**
 * Round 35: a forced win proven in the sim from the root: one own line
 * against every reply, per outcome class. `mass` is the proven share of
 * the outcome classes (a lower bound under the class model, caveat
 * named); `turns` the deepest proven line in own moves. `engineScore`
 * keeps the search's score before the bar. Present only at or above
 * MIN_FORCED_MASS.
 */
export interface ForcedWin {
  side: 'p1' | 'p2';
  turns: number;
  mass: number;
  caveat: ForcedWinCaveat;
  open?: ForcedWinOpen;
  engineScore: number;
  /** Prover states expanded (both side attempts). */
  states: number;
}

/** Proofs below this mass change nothing (round 35). */
export const MIN_FORCED_MASS = 0.5;
/** Proofs at or above this mass are spoken (round 35). */
export const SPOKEN_MASS = 0.9;

/** What the prover needs from a finished search (main-thread safe). */
export interface ForcedWinInput {
  score: number;
  unanswered?: UnansweredProfile;
  rootOrder: { p1: string[]; p2: string[] };
  tera?: TeraAllowance;
  sleepClause?: boolean;
}

export interface ForcedWinProof {
  mass: number;
  turns: number;
  caveat: ForcedWinCaveat;
  open?: ForcedWinOpen;
  /** p1-perspective static of the open root children, share-weighted; null without open root children. */
  openValue: number | null;
  states: number;
}

export interface ForcedWinOutcome { side: 'p1' | 'p2'; proof: ForcedWinProof }

export interface UnansweredProfile {
  p1: string[];
  p2: string[];
  p1Entry?: EntryUnanswered[];
  p2Entry?: EntryUnanswered[];
  /** Present only when exactly one side sweeps (round-14 caches read unchanged). */
  decided?: DecidedSweep;
  /** Present only when no decided sweep stands and exactly one side is a roll away. */
  nearDecided?: NearDecidedSweep;
}

export interface EvalMatrix {
  p1Labels: string[];
  p2Labels: string[];
  /**
   * Machine-readable choice ids aligned with the label arrays — the Read
   * lens classifies and matches on these, never on display labels. Optional
   * only for cached results written before the ids existed.
   */
  p1Choices?: string[];
  p2Choices?: string[];
  /** values[i][j]: p1-perspective wp-unit value of (p1Labels[i], p2Labels[j]). */
  values: number[][];
  /** Equilibrium average strategies, index-aligned with the label arrays. */
  mixes: { p1: number[]; p2: number[] };
}

/** An exploitative recommendation: best response to the opponent MODEL. */
export interface ReadRecommendation {
  /** choiceId is the machine id ('move recover', 'switch 3'); absent only on cached reads predating ids. */
  choice: { label: string; ev: number; worstCase: number; choiceId?: string };
  /** Own-perspective EV against the model (wp-units). */
  net: number;
  /** The model's top opponent probability — reads only surface when confident. */
  confidence: number;
  breakdown: { label: string; prob: number; value: number }[];
}

export interface SearchProgress {
  done: number;
  total: number;
  /** Depth currently being searched. */
  depth: number;
}

export interface EvalChoiceOption {
  choice: string;
  label: string;
}

export interface EvalChoicesInfo {
  p1: EvalChoiceOption[];
  p2: EvalChoiceOption[];
  /** Static eval of the root (±1 when the battle already ended). */
  rootValue: number;
  rootEnded: boolean;
  /** Per-option analytic kill odds, index-aligned with p1/p2 (round 6). */
  koOdds?: { p1: (KoOddsInfo | null)[]; p2: (KoOddsInfo | null)[] };
  /** Root unanswered-mon profile (rounds 13/14) for the orchestrated path. */
  unanswered?: UnansweredProfile;
}

export interface EvalCellJob {
  i: number;
  j: number;
  p1Choice: string;
  p2Choice: string;
  /** Number of fixed seeds to average. */
  samples: number;
}

export interface EvalCellValue {
  i: number;
  j: number;
  value: number;
  /** The first-seed child is terminal (blended cells: every sampled child is). */
  ended: boolean;
  /** Analytic class blend of a boundary cell (root cells only). */
  blend?: CellBlend;
  /** Probe budget exhausted with analytic classes unsampled. */
  diagnostic?: KoOddsMismatch;
  /**
   * Round 33: the first-seed child's depth-2 value (a depth-1 sub-search
   * on that child), set by the verify step in the MCTS mode. Below the
   * depth floor it replaces the one-ply sampler value; blended cells
   * re-blend it through the first-seed class (as reblendValue does).
   */
  deepened?: number;
}

export interface EvalSubSearchJob {
  i: number;
  j: number;
  p1Choice: string;
  p2Choice: string;
  /** Sub-search settings (depth already reduced, samples fixed to 1). */
  settings: EvalSettings;
}

/** One MCTS tree's root statistics — mergeable across parallel trees. */
export interface MctsTreeStats {
  p1Options: EvalChoiceOption[];
  p2Options: EvalChoiceOption[];
  p1N: number[];
  p1W: number[];
  p2N: number[];
  p2W: number[];
  visits: number;
  depth: number;
  /** Root static (p1 perspective) — the unexpanded-cell fallback. */
  rootValue: number;
  /**
   * Per-option kill odds at the root (index-aligned with the option lists;
   * absent for dead roots). Round 7: the merge attaches these to ranked
   * rows — mcts-merge stays sim-free, so the worker ships the facts.
   */
  koOdds?: { p1: (KoOddsInfo | null)[]; p2: (KoOddsInfo | null)[] };
  /**
   * Root cells with ≥1 priceable boundary event (planCellEvents kind
   * 'events') — chance-suspect by construction: K fixed outcomes cannot
   * represent an accuracy×killFraction split. Drives the verify sampler.
   */
  boundaryCells?: number[];
  /**
   * Root-cell tree stats for the merged equilibrium ranking: `total` is the
   * sum of every leaf value backed through the cell (expansion included),
   * `value` the child's creation-time static (the one-visit prior).
   */
  cells: {
    key: number; visits: number; total: number; value: number; ended: boolean;
    /**
     * The drawn child's outcome class on a boundary cell, when the
     * classifier recognized it (round 33) — lets the merge pool trees per
     * class instead of trusting one open class only.
     */
    classKey?: string;
  }[];
  /** This tree's own ranked result (PV/punisher donor for the merge). */
  result: EvalResult;
}

export type EvalWorkerRequest =
  | { type: 'search'; id: number; serializedBattle: string; settings: EvalSettings }
  | { type: 'mctstree'; id: number; serializedBattle: string; settings: EvalSettings; seedOffset: number }
  | { type: 'choices'; id: number; serializedBattle: string; tera: TeraAllowance; keepPlayed?: EvalSettings['keepPlayed']; sleepClause?: boolean }
  | { type: 'cells'; id: number; serializedBattle: string; jobs: EvalCellJob[] }
  | { type: 'subsearch'; id: number; serializedBattle: string; job: EvalSubSearchJob }
  | { type: 'prove'; id: number; serializedBattle: string; input: ForcedWinInput };

export type EvalWorkerResponse =
  | { type: 'progress'; id: number; progress: SearchProgress }
  | { type: 'partial'; id: number; result: EvalResult }
  | { type: 'result'; id: number; result: EvalResult }
  | { type: 'mctsTreeResult'; id: number; tree: MctsTreeStats }
  | { type: 'choicesResult'; id: number; info: EvalChoicesInfo }
  | { type: 'cellsResult'; id: number; values: EvalCellValue[] }
  | { type: 'proveResult'; id: number; outcome: ForcedWinOutcome | null }
  | { type: 'error'; id: number; message: string };
