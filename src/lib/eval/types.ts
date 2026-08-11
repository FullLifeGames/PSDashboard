import type { PlayedAction } from './played';

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
 * fraction, the DUCT tree at or above it. Measured 2026-08-11 on the
 * expanded corpus (n 417 paired): the tree's adaptive depth pays exactly
 * once bodies fall — late sign +2 over pure d1 with doubles preserved and
 * late brier within 0.002 of pure MCTS, while below the threshold the two
 * engines are calibration-identical and the matrix is far cheaper. Lives
 * here (not search.ts) so the UI layer can import it without pulling
 * @pkmn/sim into the main chunk.
 */
export const AUTO_MCTS_FAINTED_FRACTION = 0.4;

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
   * Tera enumeration: 'auto' = only when the replay terastallized (and in
   * draft/custom formats, only the Pokémon that did); 'revealed' forces the
   * per-Pokémon restriction for any format.
   */
  tera: 'auto' | 'on' | 'off' | 'revealed';
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
   * below it. MCTS results approximate this with the visit-mean.
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
  /** The first-seed child is terminal. */
  ended: boolean;
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
  /** This tree's own ranked result (PV/punisher donor for the merge). */
  result: EvalResult;
}

export type EvalWorkerRequest =
  | { type: 'search'; id: number; serializedBattle: string; settings: EvalSettings }
  | { type: 'mctstree'; id: number; serializedBattle: string; settings: EvalSettings; seedOffset: number }
  | { type: 'choices'; id: number; serializedBattle: string; tera: TeraAllowance; keepPlayed?: EvalSettings['keepPlayed']; sleepClause?: boolean }
  | { type: 'cells'; id: number; serializedBattle: string; jobs: EvalCellJob[] }
  | { type: 'subsearch'; id: number; serializedBattle: string; job: EvalSubSearchJob };

export type EvalWorkerResponse =
  | { type: 'progress'; id: number; progress: SearchProgress }
  | { type: 'partial'; id: number; result: EvalResult }
  | { type: 'result'; id: number; result: EvalResult }
  | { type: 'mctsTreeResult'; id: number; tree: MctsTreeStats }
  | { type: 'choicesResult'; id: number; info: EvalChoicesInfo }
  | { type: 'cellsResult'; id: number; values: EvalCellValue[] }
  | { type: 'error'; id: number; message: string };
