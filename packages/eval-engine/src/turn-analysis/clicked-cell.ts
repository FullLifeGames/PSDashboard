import type { EvalMatrix, RankedChoice } from '../types.ts';
import { matchClickedColumn } from './played-match.ts';
import type { AnalyzeTurnParams, Side } from './types.ts';

/** The side's own-perspective value of the cell; p1's value is stored as is, p2's negated. */
export const ownCell = (matrix: EvalMatrix, key: Side, i: number, j: number): number =>
  key === 'p1' ? matrix.values[i][j] : -matrix.values[j][i];

/** The opponent's actual click as a matrix column (-1 when unknown), with the matched choice for the sentence. */
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

/** The own-perspective cells of the named choices against the click; null (fail open) when no matrix, column or row. */
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

/** The smallest gap the card prints as "+1%": it never credits a gap it writes as "+0%". */
export const CLICK_EDGE_MIN = 0.01;

/** Whether the played cell beats the safe cell by CLICK_EDGE_MIN; the tolerance absorbs float error on the edge. */
export const beatsSafeCell = (playedValue: number, safeValue: number): boolean =>
  playedValue - safeValue >= CLICK_EDGE_MIN - 1e-9;
