import type { CellBlend, EvalMatrix, RankedChoice } from '../types.ts';

interface RankOption {
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

/** The key of matrix cell (i, j) in the maps of captured lines; assumes fewer than 10,000 columns. */
export const cellKey = (i: number, j: number) => i * 10_000 + j;

/** Re-blends a boundary cell: the sub-score replaces the first-seed leaf in its class, never the whole cell. */
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
