import { cellKey, reblendValue, type PvStep, type ValueMatrix } from '../rank.ts';
import type { CellBlend, EvalResult, EvalSettings } from '../types.ts';

/** The deepening bookkeeping the sync search and the orchestrator share; pure, no sim imports. */

export interface DeepeningState {
  matrix: ValueMatrix;
  /** cellKey to analytic class blend (root boundary cells only). */
  blends: Map<number, CellBlend>;
  /** Pre-deepening statics: the trend baseline. */
  staticValues: number[][];
  trendMap: Map<number, number>;
  pvByCell: Map<number, PvStep[]>;
}

/** Books one deepened cell: a blended cell re-blends through the first-seed child's class, so one deepened branch never overwrites the mixture. */
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

/**
 * The turn search of a forced root's cell (search/forced-root.ts): depth 1 over the child's own option lists, the root's draws per
 * cell, no prover, and none of the root's played-turn hints (they name the root's actions, which mean nothing one turn on).
 */
export function turnSettings(settings: EvalSettings): EvalSettings {
  return { ...settings, depth: 1, keepPlayed: undefined, prove: false };
}

/** The level a forced root's turn searches book as: the root's own matrix is level 1, the turn after it level 2. */
export const FORCED_ROOT_LEVEL = 2;

/**
 * Books one cell of a forced root by the turn search of its child. The turn search is the cell's horizon: the trend layers read a
 * cell's trend as the shift one more ply would make, and here that ply is the turn already played, so the cell books trend 0.
 * Otherwise the layers fold the whole gap between the arrival static and the turn value into the tied leaders again.
 */
export function recordTurnCell(state: DeepeningState, i: number, j: number, sub: EvalResult): void {
  recordDeepenedCell(state, i, j, sub, FORCED_ROOT_LEVEL, new Set<number>());
  state.trendMap.set(cellKey(i, j), 0);
}
