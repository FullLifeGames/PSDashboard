import { cellKey, reblendValue, type PvStep, type ValueMatrix } from '../rank.ts';
import { WAITING_LABEL } from '../forward/assignments.ts';
import type { SimPosition } from '../forward/position.ts';
import type { CellBlend, EvalResult, EvalSettings } from '../types.ts';
import type { SearchCallbacks } from './matrix.ts';

/** The deepening bookkeeping the sync search and the orchestrator share; pure, no sim imports. */

export interface DeepeningState {
  matrix: ValueMatrix;
  blends: Map<number, CellBlend>;
  /** Pre-deepening statics: the trend baseline. */
  staticValues: number[][];
  trendMap: Map<number, number>;
  pvByCell: Map<number, PvStep[]>;
}

export function withStaticPicks(result: EvalResult, child: Pick<SimPosition, 'staticPicks'>): EvalResult {
  if (!child.staticPicks) return result;
  const staticPicks = child.staticPicks.map(pick => ({
    p1: pick.p1 ?? WAITING_LABEL,
    p2: pick.p2 ?? WAITING_LABEL,
    replacement: pick.p1 !== undefined && pick.p2 !== undefined ? 'both' as const : pick.p1 !== undefined ? 'p1' as const : 'p2' as const,
  }));
  return { ...result, staticPicks };
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
      ...(sub.staticPicks ?? []),
      { p1: subTopP1?.label ?? '—', p2: subTopP2?.label ?? '—' },
      ...(subTopP1?.line ?? []),
    ]);
  }
}

/** Every cell whose first-seed child has not ended, row by row. */
export function liveCells(matrix: Pick<ValueMatrix, 'values' | 'ended'>): [number, number][] {
  const cells: [number, number][] = [];
  matrix.values.forEach((row, i) => row.forEach((_, j) => { if (!matrix.ended[i][j]) cells.push([i, j]); }));
  return cells;
}

/** Books the sub-searches of a whole level together, so a stop before the last one leaves every cell as it was. */
export function recordDeepenedLevel(
  state: DeepeningState, cells: [number, number][], subs: EvalResult[], depth: number,
): void {
  const expandedThisLevel = new Set<number>();
  cells.forEach(([i, j], index) => recordDeepenedCell(state, i, j, subs[index], depth, expandedThisLevel));
}

/** Level `depth` of a root: every live cell's sub-search, booked together; true if a stop came first. */
export function deepenWholeLevel(
  state: DeepeningState & { callbacks: SearchCallbacks | undefined },
  depth: number,
  search: (i: number, j: number) => EvalResult,
): boolean {
  const cells = liveCells(state.matrix);
  const subs: EvalResult[] = [];
  state.callbacks?.onProgress?.({ done: 0, total: cells.length, depth });
  for (const [i, j] of cells) {
    if (state.callbacks?.shouldStop?.()) return true;
    subs.push(search(i, j));
    state.callbacks?.onProgress?.({ done: subs.length, total: cells.length, depth });
  }
  recordDeepenedLevel(state, cells, subs, depth);
  return false;
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
