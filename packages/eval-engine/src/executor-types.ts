import type { CellBlend, CellDraw, EvalSettings, KoOddsInfo, KoOddsMismatch, UnansweredProfile } from './types.ts';
import type { PlayedBounds } from './played.ts';

// The jobs and answers between the orchestrator and its executor: a choice list, a batch of cells, a sub-search.

/** One choice string of a side with its display label. */
export interface EvalChoiceOption {
  choice: string;
  label: string;
}

/** The option lists of a root position with what the orchestrator reads of it. */
export interface EvalChoicesInfo {
  p1: EvalChoiceOption[];
  p2: EvalChoiceOption[];
  /** Static eval of the root (±1 when the battle already ended). */
  rootValue: number;
  rootEnded: boolean;
  /** Per-option analytic kill odds, index-aligned with p1/p2. */
  koOdds?: { p1: (KoOddsInfo | null)[]; p2: (KoOddsInfo | null)[] };
  /** Root unanswered-mon profile for the orchestrated path. */
  unanswered?: UnansweredProfile;
  /** The order bound of a body that fell before it acted, for the orchestrated path and the HTTP engine path. */
  playedBounds?: PlayedBounds;
  /**
   * The root stands at an open replacement request of either side: every cell is deepened by the turn search of its child
   * (`EvalSubSearchJob.turn`). Absent when false.
   */
  forced?: boolean;
}

/** One matrix cell to price: a choice pair and the number of seeds. */
export interface EvalCellJob {
  i: number;
  j: number;
  p1Choice: string;
  p2Choice: string;
  /** Number of fixed seeds to average. */
  samples: number;
  /**
   * The verify step's sub-search settings: the cell goes one ply deeper per outcome (`CellBlendClass.deepened` for a blend,
   * `EvalCellValue.deepened` for a plain cell).
   */
  deepen?: EvalSettings;
  /** One natural draw (the first search seed) and its leaf, no pair plan, no class blend: the cheap price of an unlisted answer. */
  plain?: boolean;
}

/** The value of one matrix cell. */
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
  /** The base draws that priced the cell, for the horizon-trend probe (root matrix cells only). Absent for a one-draw cell. */
  baseDraws?: CellDraw[];
  /**
   * The first-seed child's depth-2 value, set by the verify step; below the depth floor it replaces the one-ply sampler value.
   * A plain verify cell carries its outcome groups one ply deeper, mixed by draw share; blended cells carry the depth per class.
   */
  deepened?: number;
}

/** One sub-search of a cell's child. */
export interface EvalSubSearchJob {
  i: number;
  j: number;
  p1Choice: string;
  p2Choice: string;
  /** Sub-search settings (depth already reduced, samples fixed to 1). */
  settings: EvalSettings;
  /** A trend probe: the child is the one this draw leads to, and the answer carries `trend` (sub-search score minus the child's leaf). */
  draw?: CellDraw;
  /**
   * The child is searched as the whole turn it opens, with `settings` as given (option lists, the root's draws, the full ranking), not by
   * the pruned depth-1 sub-search. Set only for the cells of a forced root; absent reads false.
   */
  turn?: boolean;
}
