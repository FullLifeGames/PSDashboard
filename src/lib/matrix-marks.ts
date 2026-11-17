import type { EvalMatrix, EvalResult, RankedChoice, TurnAnalysis } from '@fulllifegames/eval-engine';
import { worstReply } from './worst-reply';

/** A cell of the matrix by its row (P1's choice) and its column (P2's choice). */
export type MatrixCellAt = readonly [row: number, column: number];

/**
 * Round 89 (B7a): what the matrix dialog marks. The played row and column and the engine's best row and column come from the card's
 * analysis; each worst cell is the cell `worstReply` names for the played choice of its side (basis `cell` only), the rule the Hard mode
 * line reads, so the dialog and the line never disagree. P1's worst cell is the lowest cell of the played row, P2's the highest cell of
 * the played column (the matrix holds P1's chance to win). Every field is null where the analysis or the result does not name it.
 */
export interface MatrixMarks {
  playedRow: number | null;
  playedColumn: number | null;
  bestRow: number | null;
  bestColumn: number | null;
  worstP1: MatrixCellAt | null;
  worstP2: MatrixCellAt | null;
}

/** The index of a ranked choice in one side's axis: by its choice id, by its label for a result cached before the ids existed; null when absent. */
function indexOnAxis(choices: readonly string[] | undefined, labels: readonly string[], entry: Pick<RankedChoice, 'choice' | 'label'> | null | undefined): number | null {
  if (!entry) return null;
  const at = choices ? choices.indexOf(entry.choice) : labels.indexOf(entry.label);
  return at < 0 ? null : at;
}

function worstCell(result: EvalResult, matrix: EvalMatrix, side: 'p1' | 'p2', played: RankedChoice | null | undefined): MatrixCellAt | null {
  if (!played) return null;
  const found = worstReply(result, side, played);
  if (!found || found.basis !== 'cell') return null;
  const own = indexOnAxis(side === 'p1' ? matrix.p1Choices : matrix.p2Choices, side === 'p1' ? matrix.p1Labels : matrix.p2Labels, played);
  const reply = indexOnAxis(side === 'p1' ? matrix.p2Choices : matrix.p1Choices, side === 'p1' ? matrix.p2Labels : matrix.p1Labels, found.reply);
  if (own === null || reply === null) return null;
  return side === 'p1' ? [own, reply] : [reply, own];
}

/** The marks of one turn; A turn that tracked no played action (`playedTracking` false) marks no played choice. */
export function matrixMarks(result: EvalResult, matrix: EvalMatrix, analysis: TurnAnalysis): MatrixMarks {
  const tracked = analysis.playedTracking !== false;
  const p1Played = tracked ? analysis.p1.played : null;
  const p2Played = tracked ? analysis.p2.played : null;
  return {
    playedRow: indexOnAxis(matrix.p1Choices, matrix.p1Labels, p1Played),
    playedColumn: indexOnAxis(matrix.p2Choices, matrix.p2Labels, p2Played),
    bestRow: indexOnAxis(matrix.p1Choices, matrix.p1Labels, analysis.p1.best),
    bestColumn: indexOnAxis(matrix.p2Choices, matrix.p2Labels, analysis.p2.best),
    worstP1: worstCell(result, matrix, 'p1', p1Played),
    worstP2: worstCell(result, matrix, 'p2', p2Played),
  };
}
