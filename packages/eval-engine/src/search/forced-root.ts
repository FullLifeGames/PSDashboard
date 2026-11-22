import { positionBattle, type SimPosition } from '../forward-model.ts';
import type { EvalResult, EvalSettings } from '../types.ts';
import { FORCED_ROOT_LEVEL, recordTurnCell, turnSettings, type DeepeningState } from './deepening.ts';
import type { Matrix, SearchCallbacks } from './matrix.ts';

/**
 * Round 89 (SB-4, #197): a forced root, and what a forced replacement is priced by under the matrix.
 *
 * A root is forced when a side has an open replacement request (a knock-out, U-turn, Volt Switch, Flip Turn, Parting Shot and kin);
 * the other side then holds the waiting sentinel (`forward/choices.ts`), or replaces too. Its cells are the switch-ins, and each
 * cell's child is the board on arrival, before any move of the turn that follows. The static prices that board without the next
 * exchange, so two bodies that look alike on arrival tie, and one that loses its race a turn later can lead (the shared game: Glimmora
 * after U-turn, against a Choice Scarf Gholdengo that takes it in two turns).
 *
 * The rule, one place for every reader (the sync search, the orchestrated search, its executors): at a forced root every cell is
 * deepened once by the engine's own search of its child, the turn that follows, at depth 1 with the root's draws and no prover. That
 * is the solved value of the turn the player would face after the replacement, the same search the engine runs when that turn comes.
 * The result reads depth 2. The pure half of the rule (the turn search's settings, the level it books as) lives in `deepening.ts`, which
 * the sim-free orchestrator imports too. The tree needs none of this: its forced node is a decision node that plays the next turn (mcts.ts,
 * search/mcts-node.ts), so Auto in doubles and in singles from a quarter fainted never reaches this rule.
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
 * Level 2 of a forced root, sync. Every switch-in's child gets the engine's own search of the turn it opens (`search`, the sync
 * search itself), so a replacement is judged by what follows it and not by the board on arrival. All cells or none: a stop before the
 * last one leaves the arrival values untouched, because one row priced by its turn beside rows priced by arrival would rank on two
 * scales. True when stopped. The orchestrator's `deepenForcedRootAsync` does the same through the executor.
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
