import type { EvalMatrix, EvalResult, RankedChoice } from '../types.ts';
import { cellSolid } from './cell-solid.ts';

type Side = 'p1' | 'p2';

/** The answer that hurts one row most; `basis` 'cell' is the row's lowest trusted cell, 'punisher' its own floor (`punishedBy`) when no cell is trusted. */
export interface WorstAnswer { label: string; choice: string; basis: 'cell' | 'punisher' }

/** The reply that hurts `row` of `side` most, or null (the caller then falls back to the other side's best row); reads the result only. */
export function worstAnswer(result: Pick<EvalResult, 'matrix' | 'perSide'>, side: Side, row: Pick<RankedChoice, 'choice' | 'label' | 'punishedBy'>): WorstAnswer | null {
  // The lowest value of the row from the row's own side (p1's lowest cell, p2's highest cell of the p1-perspective matrix) among the
  // trusted cells (`cellSolid`: a result without cell statistics, a matrix pass or an old cache, trusts every cell), the first of equals.
  // Only a reply the other side's ranked list holds counts, and a waiting side is no reply. Without such a cell: the row's own floor,
  // when the ranked list holds it.
  const other: Side = side === 'p1' ? 'p2' : 'p1';
  const ranked = result.perSide[other];
  const cell = result.matrix ? lowestTrustedCell(result.matrix, side, row, ranked) : null;
  if (cell) return { ...cell, basis: 'cell' };
  const named = row.punishedBy === null ? undefined : ranked.find(entry => entry.label === row.punishedBy && entry.choice !== 'wait');
  return named ? { label: named.label, choice: named.choice, basis: 'punisher' } : null;
}

/**
 * One side's view of the matrix: its own and the other side's labels and choices, and the cell and value (this side's view) at a row and
 * a column.
 */
function viewOf(matrix: EvalMatrix, side: Side) {
  const p1 = side === 'p1';
  return {
    own: p1 ? matrix.p1Labels : matrix.p2Labels, ownChoices: p1 ? matrix.p1Choices : matrix.p2Choices,
    against: p1 ? matrix.p2Labels : matrix.p1Labels, againstChoices: p1 ? matrix.p2Choices : matrix.p1Choices,
    // from the row's own side: p1 wants the cell low, p2 wants the p1 value high
    at: (row: number, column: number) => {
      const [i, j] = p1 ? [row, column] : [column, row];
      return { cell: matrix.cells?.[i]?.[j], value: p1 ? matrix.values[i][j] : -matrix.values[i][j] };
    },
  };
}

/**
 * The reply of the lowest trusted cell of the row (the first of equals), among the replies the ranked list holds; null when there is
 * none.
 */
function lowestTrustedCell(
  matrix: EvalMatrix, side: Side, row: Pick<RankedChoice, 'choice' | 'label'>, ranked: readonly RankedChoice[],
): { label: string; choice: string } | null {
  const view = viewOf(matrix, side);
  const at = view.ownChoices ? view.ownChoices.indexOf(row.choice) : view.own.indexOf(row.label);
  const choices = view.againstChoices;
  if (at < 0 || !choices) return null;
  const options = view.against.flatMap((label, index) => {
    const { cell, value } = view.at(at, index);
    const listed = choices[index] !== 'wait' && ranked.some(entry => entry.choice === choices[index] && entry.label === label);
    return listed && cellSolid(cell) ? [{ label, choice: choices[index], value }] : [];
  });
  const lowest = options.reduce<(typeof options)[number] | null>((best, option) => (best === null || option.value < best.value ? option : best), null);
  return lowest ? { label: lowest.label, choice: lowest.choice } : null;
}

/** Each row's worst answer by label, by side: what `rowLines` keeps the floor lines for (a row without one is left out). */
export function floorLabels(result: Pick<EvalResult, 'matrix' | 'perSide'>): Record<Side, Record<string, string>> {
  const out: Record<Side, Record<string, string>> = { p1: {}, p2: {} };
  for (const side of ['p1', 'p2'] as const) {
    for (const row of result.perSide[side]) {
      const answer = worstAnswer(result, side, row);
      if (answer) out[side][row.label] = answer.label;
    }
  }
  return out;
}
