import type { CellBlend, EvalMatrix, RankedChoice } from '../types';

/**
 * The value matrix the ranking runs over, the ranked record it produces,
 * and the cell helpers (keys, re-blending) every consumer shares. Pure —
 * no @pkmn/sim imports, main-bundle safe.
 */

export interface RankOption {
  choice: string;
  label: string;
}

export interface ValueMatrix {
  p1Options: RankOption[];
  p2Options: RankOption[];
  /** values[i][j]: p1-perspective value of (p1Options[i], p2Options[j]). */
  values: number[][];
  /** ended[i][j]: the first-seed child is terminal (never worth deepening). */
  ended: boolean[][];
}

export interface Ranked {
  p1: RankedChoice[];
  p2: RankedChoice[];
  v1: number;
  v2: number;
  /** Solved value of the matrix game (p1 perspective); rootValue when a side has no options. */
  gameValue: number;
  /** The solved matrix + mixes, for the Read lens (absent when degenerate). */
  matrixOut?: EvalMatrix;
}

export type PvStep = { p1: string; p2: string };

export const cellKey = (i: number, j: number) => i * 10_000 + j;

/**
 * Re-blend a boundary cell after deepening: the deepened sub-search score
 * replaces the FIRST-SEED child's leaf inside its outcome class; every other
 * class keeps its sampled mean and analytic weight. Without this, writing
 * the sub-score into the cell would silently erase the blend (a 43% kill
 * branch would grade certain again the moment depth 2 expands it).
 */
export function reblendValue(blend: CellBlend, subScore: number): number {
  let value = 0;
  for (const cls of blend.classes) {
    const mean = cls.hasFirst
      ? (cls.leafSum - blend.firstLeaf + subScore) / cls.count
      : cls.leafSum / cls.count;
    value += cls.weight * mean;
  }
  return value;
}

export const TOP_EXPANSION = 5;
