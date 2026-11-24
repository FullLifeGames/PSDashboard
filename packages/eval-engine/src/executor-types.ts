import type { CellBlend, CellDraw, EvalSettings, KoOddsInfo, KoOddsMismatch, UnansweredProfile } from './types.ts';
import type { PlayedBounds } from './played.ts';

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
  unanswered?: UnansweredProfile;
  playedBounds?: PlayedBounds;
  /** The root is an open replacement request: each cell gets its child's turn search (`EvalSubSearchJob.turn`). */
  forced?: boolean;
}

/** One matrix cell to price: a choice pair and the number of seeds. */
export interface EvalCellJob {
  i: number;
  j: number;
  p1Choice: string;
  p2Choice: string;
  samples: number;
  /** The verify step's sub-search settings: the cell goes one ply deeper per outcome. */
  deepen?: EvalSettings;
  /** One natural draw (the first search seed) and its leaf, no pair plan, no class blend. */
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
  /** The base draws that priced the cell (root matrix cells only); absent for a one-draw cell. */
  baseDraws?: CellDraw[];
  /** The first-seed child's depth-2 value from the verify step; below the depth floor it replaces the one-ply value. */
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
  /** A trend probe: the child this draw leads to; the answer carries `trend` (sub-search score minus the leaf). */
  draw?: CellDraw;
  /** The child is searched as the whole turn it opens, with `settings` as given, not pruned; forced roots only. */
  turn?: boolean;
}
