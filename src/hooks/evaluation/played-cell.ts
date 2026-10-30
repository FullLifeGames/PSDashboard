import type { EvalResult } from '@fulllifegames/eval-engine';

/**
 * Round 79 (T287): the value the tree itself holds for the pair both sides clicked. The roots around a tree turn
 * (`scoreBefore`, `scoreAfter`) are made of the merged matrix's cells; a depth-1 sub-search of the played pair is another
 * estimator, and the gap between the two leaked into the decision and chance parts of the turn (573756: 0.061 on average
 * over its tree turns, 0.29 for 649664, 0.25 for regi-2629703929). Null where the matrix does not price the pair: no
 * matrix or no cells (a result cached before the field existed), a choice that is no row or column, a cell no tree visited
 * and no verify step re-priced (the merge fills it with the root value, which says nothing about the pair).
 * The values are p1-perspective wp-units, the unit of a sub-search's score.
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
