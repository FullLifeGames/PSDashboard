import { cellKey, reblendValue, type PvStep, type ValueMatrix } from '../rank.ts';
import type { CellBlend, EvalResult, EvalSettings } from '../types.ts';

/** The deepening bookkeeping the sync search and the orchestrator share; pure, no sim imports. */

export interface DeepeningState {
  matrix: ValueMatrix;
  blends: Map<number, CellBlend>;
  /** Pre-deepening statics: the trend baseline. */
  staticValues: number[][];
  trendMap: Map<number, number>;
  pvByCell: Map<number, PvStep[]>;
}

/** Books one deepened cell; a blended cell re-blends through the first-seed child's class, never overwritten. */
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

/** Settings of a forced root cell's turn search: depth 1, the root's draws, no prover, no played-turn hints. */
export function turnSettings(settings: EvalSettings): EvalSettings {
  return { ...settings, depth: 1, keepPlayed: undefined, prove: false };
}

/** The level a forced root's turn searches book as (the root's own matrix is level 1). */
export const FORCED_ROOT_LEVEL = 2;

/** Books one forced-root cell by the turn search of its child, trend 0: the turn already played is the horizon. */
export function recordTurnCell(state: DeepeningState, i: number, j: number, sub: EvalResult): void {
  recordDeepenedCell(state, i, j, sub, FORCED_ROOT_LEVEL, new Set<number>());
  state.trendMap.set(cellKey(i, j), 0);
}
