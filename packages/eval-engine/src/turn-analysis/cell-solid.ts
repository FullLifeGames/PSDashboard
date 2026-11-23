import type { MatrixCell } from '../types.ts';

// The trust bar of a root cell, one rule for the hindsight read (`signals.ts`) and the worst answer (`worst-answer.ts`). Sim-free.
export const HINDSIGHT_MIN_VISITS = 8;

/**
 * The cell behind a read is no guess: enough visits or re-priced by the verify step; a cell the result does not carry passes. So is a
 * cell the planner calls plain ("none": no accuracy roll and no kill range in the pair) once a tree expanded it, since its one outcome
 * needs no second visit (the best row against a clicked Wide Guard, 4 visits, value 1.00). A plain cell nobody expanded reads the root
 * static and stays a guess.
 */
export const cellSolid = (cell: Pick<MatrixCell, 'visits' | 'verified' | 'plan'> | undefined): boolean =>
  !cell || cell.verified || cell.visits >= HINDSIGHT_MIN_VISITS || (cell.plan === 'none' && cell.visits >= 1);
