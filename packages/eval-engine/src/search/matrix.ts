import type { MatchupCache } from '../eval-function';
import { positionBattle, type ChoiceOption, type SimPosition } from '../forward-model';
import { cellKey, type ValueMatrix } from '../rank';
import type { CellBlend, EvalResult, KoOddsMismatch, SearchProgress } from '../types';
import { countFainted } from './leaf';
import { sampleCell } from './cell-sampler';

/**
 * The root matrix over both option lists, and the memoized alpha/beta
 * passes the pruned depth-1 sub-search runs over it.
 */

export interface SearchCallbacks {
  onProgress?(progress: SearchProgress): void;
  onPartial?(result: EvalResult): void;
  /** Checked between matrix cells; returning true stops deepening (current result is returned). */
  shouldStop?(): boolean;
}

export interface Matrix extends ValueMatrix {
  /** children[i][j]: first-seed child position (kept for deepening). */
  children: SimPosition[][];
  /** cellKey(i, j) → analytic class blend (root boundary cells only). */
  blends: Map<number, CellBlend>;
  /** Boundary cells whose analytic classes went unsampled (probe budget). */
  diagnostics: KoOddsMismatch[];
}

export function buildMatrix(
  position: SimPosition,
  p1Options: ChoiceOption[],
  p2Options: ChoiceOption[],
  samples: number,
  depth: number,
  callbacks: SearchCallbacks | undefined,
  progress: { done: number; total: number },
  matchupCache: MatchupCache,
  blendRoot = false,
): Matrix {
  const rootFainted = countFainted(positionBattle(position));
  const values: number[][] = [];
  const ended: boolean[][] = [];
  const children: SimPosition[][] = [];
  const blends = new Map<number, CellBlend>();
  const diagnostics: KoOddsMismatch[] = [];

  for (let i = 0; i < p1Options.length; i++) {
    values.push([]);
    ended.push([]);
    children.push([]);
    for (let j = 0; j < p2Options.length; j++) {
      const cell = sampleCell(position, rootFainted, p1Options[i].choice, p2Options[j].choice, samples, matchupCache, blendRoot);
      values[i].push(cell.value);
      ended[i].push(cell.ended);
      children[i].push(cell.firstChild);
      if (cell.blend) blends.set(cellKey(i, j), cell.blend);
      if (cell.diagnostic) diagnostics.push({ ...cell.diagnostic, i, j });
      progress.done += 1;
      callbacks?.onProgress?.({ done: progress.done, total: progress.total, depth });
    }
  }

  return { p1Options, p2Options, values, ended, children, blends, diagnostics };
}

/** Memoized cell sampler over the root's option lists (plain seed average, no blend). */
export function cellValueMemo(
  root: SimPosition,
  rootFainted: number,
  p1Options: ChoiceOption[],
  p2Options: ChoiceOption[],
  samples: number,
  matchupCache: MatchupCache,
): (i: number, j: number) => number {
  const cellMemo = new Map<number, number>();
  return (i, j) => {
    const key = cellKey(i, j);
    let value = cellMemo.get(key);
    if (value === undefined) {
      value = sampleCell(root, rootFainted, p1Options[i].choice, p2Options[j].choice, samples, matchupCache).value;
      cellMemo.set(key, value);
    }
    return value;
  };
}

/** Pass A: v1 = max_i min_j with alpha cutoffs (first encounter wins ties). */
export function maximinRows(
  cellValue: (i: number, j: number) => number,
  rows: number,
  cols: number,
): { v1: number; bestI: number; bestIPunish: number } {
  let v1 = -Infinity;
  let bestI = 0;
  let bestIPunish = 0;
  for (let i = 0; i < rows; i++) {
    let rowMin = Infinity;
    let punish = 0;
    let cut = false;
    for (let j = 0; j < cols; j++) {
      const value = cellValue(i, j);
      if (value < rowMin) {
        rowMin = value;
        punish = j;
      }
      if (rowMin < v1) {
        cut = true;
        break;
      }
    }
    if (!cut && rowMin > v1) {
      v1 = rowMin;
      bestI = i;
      bestIPunish = punish;
    }
  }
  return { v1, bestI, bestIPunish };
}

/** Pass B: v2 = min_j max_i with beta cutoffs, reusing the memo. */
export function minimaxColumns(
  cellValue: (i: number, j: number) => number,
  rows: number,
  cols: number,
): { v2: number; bestJ: number; bestJPunish: number } {
  let v2 = Infinity;
  let bestJ = 0;
  let bestJPunish = 0;
  for (let j = 0; j < cols; j++) {
    let colMax = -Infinity;
    let punish = 0;
    let cut = false;
    for (let i = 0; i < rows; i++) {
      const value = cellValue(i, j);
      if (value > colMax) {
        colMax = value;
        punish = i;
      }
      if (colMax > v2) {
        cut = true;
        break;
      }
    }
    if (!cut && colMax < v2) {
      v2 = colMax;
      bestJ = j;
      bestJPunish = punish;
    }
  }
  return { v2, bestJ, bestJPunish };
}
