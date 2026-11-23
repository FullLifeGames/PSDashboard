import type { EvalMatrix, RankedChoice } from '../types.ts';
import { matchClickedColumn } from './played-match.ts';
import type { AnalyzeTurnParams, Side } from './types.ts';

// The opponent's clicked column of the solved matrix and the side's own cells in it: one reading for the hindsight read and the paid-off test.

/** The side's own-perspective value of the cell (own row index i, opponent column index j); p1's value is stored as is, p2's is negated. */
export const ownCell = (matrix: EvalMatrix, key: Side, i: number, j: number): number =>
  key === 'p1' ? matrix.values[i][j] : -matrix.values[j][i];

/** The opponent's ACTUAL click as a matrix column (−1 when unknown), with the matched choice for the sentence. */
export function opponentColumn(
  params: AnalyzeTurnParams,
  key: Side,
  matrix: EvalMatrix,
): { column: number; oppPlayed: RankedChoice | null } {
  const oppKey = key === 'p1' ? 'p2' as const : 'p1' as const;
  const oppChoices = key === 'p1' ? matrix.p2Choices : matrix.p1Choices;
  const oppPlayed = matchClickedColumn(params.result, oppKey, params.played);
  const column = oppPlayed && oppChoices ? oppChoices.indexOf(oppPlayed.choice) : -1;
  return { column, oppPlayed };
}

/**
 * The own-perspective cells of the named own choices against the opponent's click, in the order asked, with the clicked label.
 * Null (fail open for every reader) when the result has no matrix, the click has no column (a hidden doubles slot, a click the
 * matrix does not list) or one of the choices has no row.
 */
export function clickedCells(
  params: AnalyzeTurnParams,
  key: Side,
  ownChoices: string[],
): { against: string; values: number[] } | null {
  const matrix = params.result.matrix;
  const rows = key === 'p1' ? matrix?.p1Choices : matrix?.p2Choices;
  if (!matrix || !rows) return null;
  const { column, oppPlayed } = opponentColumn(params, key, matrix);
  if (column < 0 || !oppPlayed) return null;
  const indexes = ownChoices.map(choice => rows.indexOf(choice));
  if (indexes.some(index => index < 0)) return null;
  return { against: oppPlayed.label, values: indexes.map(index => ownCell(matrix, key, index, column)) };
}

/**
 * The played line must beat the safe line in the clicked column by at least one shown point (the smallest gap the card prints as
 * "+1%"), so the card never credits a gap it writes as "+0%" (0.189 against 0.190).
 */
export const CLICK_EDGE_MIN = 0.01;

/** Whether the played cell beats the safe cell by CLICK_EDGE_MIN; the tolerance absorbs the float error of a cell on the edge (0.21 − 0.20). */
export const beatsSafeCell = (playedValue: number, safeValue: number): boolean =>
  playedValue - safeValue >= CLICK_EDGE_MIN - 1e-9;
