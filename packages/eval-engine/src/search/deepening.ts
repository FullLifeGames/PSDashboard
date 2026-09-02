import { cellKey, reblendValue, type PvStep, type ValueMatrix } from '../rank';
import type { CellBlend, EvalResult } from '../types';

/**
 * The deepening bookkeeping the sync search and the orchestrator share:
 * a deepened cell's value replaces the static (re-blended through the
 * first-seed child's class where a blend exists), its depth-2 trend is
 * recorded against the static baseline, and its principal variation is
 * kept for the lines. Pure — no sim imports.
 */

export interface DeepeningState {
  matrix: ValueMatrix;
  /** cellKey → analytic class blend (root boundary cells only). */
  blends: Map<number, CellBlend>;
  /** Pre-deepening statics: the trend baseline (uniformly 1-ply-vs-static). */
  staticValues: number[][];
  trendMap: Map<number, number>;
  pvByCell: Map<number, PvStep[]>;
}

/**
 * Books one deepened cell. A blended cell re-blends through the first-seed
 * child's class — one deepened branch must not overwrite the mixture.
 */
export function recordDeepenedCell(
  state: DeepeningState,
  i: number,
  j: number,
  sub: EvalResult,
  depth: number,
  expandedThisLevel: Set<number>,
): void {
  if (depth === 2) state.trendMap.set(cellKey(i, j), sub.score - state.staticValues[i][j]);
  const cellBlend = state.blends.get(cellKey(i, j));
  state.matrix.values[i][j] = cellBlend ? reblendValue(cellBlend, sub.score) : sub.score;
  expandedThisLevel.add(cellKey(i, j));
  const subTopP1 = sub.perSide.p1[0];
  const subTopP2 = sub.perSide.p2[0];
  if (subTopP1 || subTopP2) {
    state.pvByCell.set(cellKey(i, j), [
      { p1: subTopP1?.label ?? '—', p2: subTopP2?.label ?? '—' },
      ...(subTopP1?.line ?? []),
    ]);
  }
}
