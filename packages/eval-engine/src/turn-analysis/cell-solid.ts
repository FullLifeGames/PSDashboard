import type { MatrixCell } from '../types.ts';

/**
 * Round 89 (#153): the trust bar of a root cell, in a module of its own so the hindsight read (`signals.ts`) and the worst answer
 * (`worst-answer.ts`, read by the lines job and the app) hold one rule. Sim-free.
 */
export const HINDSIGHT_MIN_VISITS = 8;

/**
 * The cell behind a read is no guess: enough visits or re-priced by the verify step; a cell the result does not carry passes.
 * Round 70 (gate of 13.10. 20:26, 2a): so is a cell the planner calls plain ("none": no accuracy roll and no kill range in the
 * pair, the pair plan's plain cell in doubles) once a tree expanded it, since its one outcome needs no second visit to be seen
 * (2630685175 t7: the best row against the clicked Wide Guard, 4 visits, value 1.00). A plain cell nobody expanded reads the
 * root static and stays a guess.
 */
export const cellSolid = (cell: Pick<MatrixCell, 'visits' | 'verified' | 'plan'> | undefined): boolean =>
  !cell || cell.verified || cell.visits >= HINDSIGHT_MIN_VISITS || (cell.plan === 'none' && cell.visits >= 1);
