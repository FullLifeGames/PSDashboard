import { positionBattle, type SimPosition } from '../forward-model.ts';
import type { EvalResult, EvalSettings } from '../types.ts';
import { FORCED_ROOT_LEVEL, recordTurnCell, turnSettings, type DeepeningState } from './deepening.ts';
import type { Matrix, SearchCallbacks } from './matrix.ts';

/**
 * A forced root: a side has an open replacement request (a knock-out, U-turn, Volt Switch, Flip Turn, Parting Shot and kin), and
 * the other side holds the waiting sentinel (`forward/choices.ts`) or replaces too. Each switch-in cell's child is the board on
 * arrival, which the static prices without the next exchange: two bodies that look alike on arrival tie, and one that loses its race
 * a turn later can lead (Glimmora after U-turn, against a Choice Scarf Gholdengo that takes it in two turns). So at a forced root
 * every cell is deepened once by the engine's own search of its child, at depth 1 with the root's draws and no prover, and the
 * result reads depth 2. The pure half (the turn search's settings, the level it books as) lives in `deepening.ts`. The tree needs
 * none of this: its forced node is a decision node that plays the next turn.
 */

/** Whether the root stands at an open replacement request of either side. */
export function isForcedRoot(root: SimPosition): boolean {
  return positionBattle(root).sides.slice(0, 2).some(side => {
    const request = side.activeRequest as { forceSwitch?: boolean[] } | null;
    return !!request?.forceSwitch?.some(Boolean);
  });
}

/** What the sync search hands the forced root's level: its deepening record, the matrix with the cells' children, its settings and stop flag. */
export interface ForcedRootState extends DeepeningState {
  matrix: Matrix;
  settings: EvalSettings;
  callbacks: SearchCallbacks | undefined;
}

/**
 * Level 2 of a forced root, sync: every switch-in's child gets the engine's own search of the turn it opens (`search`), so a
 * replacement is judged by what follows it and not by the board on arrival. All cells or none: a stop before the last one leaves
 * the arrival values untouched, because one row priced by its turn beside rows priced by arrival would rank on two scales. True
 * when stopped. The orchestrator's `deepenForcedRootAsync` does the same through the executor.
 */
export function deepenForcedRoot(state: ForcedRootState, search: (serialized: string, settings: EvalSettings) => EvalResult): boolean {
  const { matrix } = state;
  const cells: [number, number][] = [];
  matrix.values.forEach((row, i) => row.forEach((_, j) => { if (!matrix.ended[i][j]) cells.push([i, j]); }));
  const settings = turnSettings(state.settings);
  const subs: EvalResult[] = [];
  for (const [i, j] of cells) {
    if (state.callbacks?.shouldStop?.()) return true;
    subs.push(search(matrix.children[i][j].serialized, settings));
    state.callbacks?.onProgress?.({ done: subs.length, total: cells.length, depth: FORCED_ROOT_LEVEL });
  }
  cells.forEach(([i, j], index) => recordTurnCell(state, i, j, subs[index]));
  return false;
}
