import { positionBattle, type SimPosition } from '../forward-model.ts';
import type { EvalResult, EvalSettings } from '../types.ts';
import { FORCED_ROOT_LEVEL, recordTurnCell, turnSettings, type DeepeningState } from './deepening.ts';
import type { Matrix, SearchCallbacks } from './matrix.ts';

/** A forced root (an open replacement request): each cell is deepened once by the engine's search of its board. */

/** Whether the root stands at an open replacement request of either side. */
export function isForcedRoot(root: SimPosition): boolean {
  return positionBattle(root).sides.slice(0, 2).some(side => {
    const request = side.activeRequest as { forceSwitch?: boolean[] } | null;
    return !!request?.forceSwitch?.some(Boolean);
  });
}

export interface ForcedRootState extends DeepeningState {
  matrix: Matrix;
  settings: EvalSettings;
  callbacks: SearchCallbacks | undefined;
}

// A stop before the last cell leaves the arrival values untouched: rows on two scales would rank wrongly.
/** Forced root level 2: each switch-in's child gets the engine's search of its turn, all or none; true if stopped. */
export function deepenForcedRoot(state: ForcedRootState, search: (serialized: string, settings: EvalSettings) => EvalResult): boolean {
  const { matrix } = state;
  const cells: [number, number][] = [];
  matrix.values.forEach((row, i) => row.forEach((_, j) => { if (!matrix.ended[i][j]) cells.push([i, j]); }));
  const settings = turnSettings(state.settings);
  const subs: EvalResult[] = [];
  state.callbacks?.onProgress?.({ done: 0, total: cells.length, depth: FORCED_ROOT_LEVEL });
  for (const [i, j] of cells) {
    if (state.callbacks?.shouldStop?.()) return true;
    subs.push(search(matrix.children[i][j].serialized, settings));
    state.callbacks?.onProgress?.({ done: subs.length, total: cells.length, depth: FORCED_ROOT_LEVEL });
  }
  cells.forEach(([i, j], index) => recordTurnCell(state, i, j, subs[index]));
  return false;
}
