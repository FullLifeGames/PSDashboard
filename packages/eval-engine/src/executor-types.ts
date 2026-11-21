import type { CellBlend, CellDraw, EvalSettings, KoOddsInfo, KoOddsMismatch, UnansweredProfile } from './types.ts';
import type { PlayedBounds } from './played.ts';

/**
 * The jobs and answers between the orchestrator and its executor: a choice list, a batch of cells, a sub-search. Split out of
 * `types.ts` (round 89, SB-4) to keep that file under its line limit; `types.ts` re-exports every name, so imports are unchanged.
 */

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
  /** Round 89 (#108): the order bound of a body that fell before it acted, for the orchestrated path and the HTTP engine path. */
  playedBounds?: PlayedBounds;
  /**
   * Round 89 (SB-4, #197): the root stands at an open replacement request of either side. The matrix then deepens every cell by the
   * turn search of its child (`EvalSubSearchJob.turn`). Absent when false; a reader that does not know it searches as before.
   */
  forced?: boolean;
}

export interface EvalCellJob {
  i: number;
  j: number;
  p1Choice: string;
  p2Choice: string;
  /** Number of fixed seeds to average. */
  samples: number;
  /**
   * Round 63 (T16): the verify step's sub-search settings. With them the
   * cell goes one ply deeper per outcome in the same job: every open class
   * of a blend (CellBlendClass.deepened), or the outcome groups of a plain
   * cell over more natural draws (EvalCellValue.deepened).
   */
  deepen?: EvalSettings;
  /**
   * Round 67 (T128): one natural draw (the first search seed) and its leaf,
   * no pair plan and no class blend: the answer round's cheap price of a
   * row against an answer the tree did not list.
   */
  plain?: boolean;
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
   * Round 70: the base draws that priced the cell, for the horizon-trend probe
   * (root matrix cells only). Absent for a cell of one draw of the first seed,
   * whose child the probe takes for the cell.
   */
  baseDraws?: CellDraw[];
  /**
   * Round 33: the first-seed child's depth-2 value (a depth-1 sub-search
   * on that child), set by the verify step in the MCTS mode. Below the
   * depth floor it replaces the one-ply sampler value; blended cells
   * re-blend it through the first-seed class (as reblendValue does).
   * Round 63 (T16): a plain verify cell carries its outcome groups one ply
   * deeper, mixed by draw share; blended cells carry the depth per class.
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
  /**
   * Round 70: a trend probe. The child is the one this draw of the cell leads
   * to (not the first seed's), and the answer carries `trend`, the sub-search
   * score minus the child's own leaf.
   */
  draw?: CellDraw;
  /**
   * Round 89 (SB-4, #197): the child is searched as the whole turn it opens, with `settings` as given (the engine's own search of
   * that board: its option lists, the root's draws, the full ranking), not by the pruned depth-1 sub-search the deepening uses.
   * Set only for the cells of a forced root. Absent reads false.
   */
  turn?: boolean;
}
