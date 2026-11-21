import { cellKey, reblendValue, type PvStep, type ValueMatrix } from '../rank.ts';
import type { CellBlend, EvalResult, EvalSettings } from '../types.ts';

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

/**
 * Round 89 (SB-4, #197): the turn search of a forced root's cell (search/forced-root.ts). Depth 1 over the child's own option lists,
 * the root's draws per cell, no prover, and none of the root's played-turn hints (they name the root's actions, which mean nothing
 * one turn on).
 */
export function turnSettings(settings: EvalSettings): EvalSettings {
  return { ...settings, depth: 1, keepPlayed: undefined, prove: false };
}

/** The level a forced root's turn searches book as: the root's own matrix is level 1, the turn after it level 2. */
export const FORCED_ROOT_LEVEL = 2;

/**
 * Books one cell of a forced root by the turn search of its child. The turn search is the cell's horizon: the trend layers read a
 * cell's trend as the shift one more ply would make, and here "one more ply" is the turn the search already played, so the cell books
 * trend 0. Without it the layers would fold the whole gap between the arrival static and the turn value into the tied leaders again
 * (655336 turn 5: Lopunny and Landorus-T moved up by 0.04 each, away from the turn search's own values).
 */
export function recordTurnCell(state: DeepeningState, i: number, j: number, sub: EvalResult): void {
  recordDeepenedCell(state, i, j, sub, FORCED_ROOT_LEVEL, new Set<number>());
  state.trendMap.set(cellKey(i, j), 0);
}
