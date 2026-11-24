import type { MatrixCell } from '../types.ts';

export const HINDSIGHT_MIN_VISITS = 8;

/** A cell is no guess: enough visits or verified; a plain ("none") cell a tree expanded, or no cell, also passes. */
export const cellSolid = (cell: Pick<MatrixCell, 'visits' | 'verified' | 'plan'> | undefined): boolean =>
  !cell || cell.verified || cell.visits >= HINDSIGHT_MIN_VISITS || (cell.plan === 'none' && cell.visits >= 1);
