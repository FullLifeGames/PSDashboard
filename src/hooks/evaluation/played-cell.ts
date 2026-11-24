import type { EvalResult } from '@fulllifegames/eval-engine';

/** The tree's own value for the clicked pair, p1-perspective wp-units; null where the matrix prices no such pair. */
export function playedCellValue(result: EvalResult, p1Choice: string, p2Choice: string): number | null {
  const matrix = result.matrix;
  if (!matrix?.cells || !matrix.p1Choices || !matrix.p2Choices) return null;
  const row = matrix.p1Choices.indexOf(p1Choice);
  const column = matrix.p2Choices.indexOf(p2Choice);
  if (row < 0 || column < 0) return null;
  const cell = matrix.cells[row]?.[column];
  const value = matrix.values[row]?.[column];
  if (!cell || value === undefined || !Number.isFinite(value)) return null;
  return cell.visits > 0 || cell.verified ? value : null;
}
