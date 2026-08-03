/** Engine settings sent to the worker. */
export interface EvalSettings {
  /** Turns ahead. 1 = full joint matrix only. */
  depth: 1 | 2 | 3;
  /** Number of fixed PRNG seeds averaged per matrix cell. */
  samples: 1 | 3 | 5;
  /** Enumerate Terastallize move variants (default true). */
  tera?: boolean;
  /** 'mcts' runs the DUCT tree search instead of the fixed-depth matrix. */
  mode?: 'matrix' | 'mcts';
}

/** Panel preferences persisted in localStorage (worker only sees EvalSettings). */
export interface EvalPreferences {
  /** UI offers 1/2 only — depth 3 costs 3-4× for capped gains (MCTS is the "deeper" mode). */
  depth: 1 | 2;
  samples: 1 | 3 | 5;
  /** 'mcts' runs the DUCT tree search; depth/samples then don't apply. */
  mode: 'matrix' | 'mcts';
  /** Re-run automatically after each executed branch turn. */
  auto: boolean;
  /** Tera enumeration: 'auto' = on only when the replay actually terastallized. */
  tera: 'auto' | 'on' | 'off';
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
  /** Value after the opponent's best (most punishing) reply. */
  worstCase: number;
  /** Mean value over all opponent replies. */
  expected: number;
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
  /** [-1, +1] from p1's perspective: midpoint of the two sides' maximin guarantees. */
  score: number;
  /**
   * Width of the [v1, v2] interval the true game value lies in. Near 0 = a
   * stable line exists; wide = the turn hinges on out-predicting the
   * opponent (a genuine toss-up).
   */
  interval: number;
  depthCompleted: number;
  perSide: { p1: RankedChoice[]; p2: RankedChoice[] };
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
  | { type: 'choices'; id: number; serializedBattle: string; tera: boolean }
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
