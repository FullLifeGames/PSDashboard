import type { EvalResult } from '@fulllifegames/eval-engine';

/**
 * The value the tree itself holds for the pair both sides clicked: the roots around a tree turn (`scoreBefore`, `scoreAfter`) are made
 * of the merged matrix's cells, and a depth-1 sub-search of the played pair is another estimator whose gap leaked into the decision and
 * chance parts. Null where the matrix does not price the pair: no matrix or cells, a choice that is no row or column, a cell no tree
 * visited and no verify step re-priced (the merge fills it with the root value). p1-perspective wp-units.
 */
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
