/** Engine settings sent to the worker. */
export interface EvalSettings {
  /** Turns ahead. 1 = full joint matrix only. */
  depth: 1 | 2 | 3;
  /** Number of fixed PRNG seeds averaged per matrix cell. */
  samples: 1 | 3 | 5;
  /** Enumerate Terastallize move variants (default true). */
  tera?: boolean;
}

/** Panel preferences persisted in localStorage (worker only sees EvalSettings). */
export interface EvalPreferences {
  depth: 1 | 2 | 3;
  samples: 1 | 3 | 5;
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
  depthCompleted: number;
  perSide: { p1: RankedChoice[]; p2: RankedChoice[] };
}

export interface SearchProgress {
  done: number;
  total: number;
  /** Depth currently being searched. */
  depth: number;
}

export type EvalWorkerRequest =
  | { type: 'search'; id: number; serializedBattle: string; settings: EvalSettings };

export type EvalWorkerResponse =
  | { type: 'progress'; id: number; progress: SearchProgress }
  | { type: 'partial'; id: number; result: EvalResult }
  | { type: 'result'; id: number; result: EvalResult }
  | { type: 'error'; id: number; message: string };
