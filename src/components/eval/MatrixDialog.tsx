import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { EvalResult, TurnAnalysis } from '@fulllifegames/eval-engine';
import { matrixMarks } from '../../lib/matrix-marks';
import { ModalDialog } from '../ModalDialog';
import { MatrixTable } from './MatrixTable';

type PickPair = (p1: { choice: string; label: string }, p2: { choice: string; label: string }) => void;

interface MatrixDialogProps {
  result: EvalResult;
  analysis: TurnAnalysis;
  playerNames: [string, string];
  /** The panel's handler of a cell click (the overview's): the dialog plays the pair out and closes. */
  onPickPair?: PickPair;
  onClose: () => void;
}

/**
 * Round 89 (B7a): the turn's payoff matrix at reading size. It reads what the overview's matrix reads (`result.matrix`) and what the card
 * grades (`analysis`): the played row and column, the engine's best row and column, each player's worst cell (the Hard mode rule,
 * `worstReply`) and the equilibrium weights. Singles choices are moves, doubles choices pairs: labels wrap and the table scrolls in its box.
 */
function MatrixDialog({ result, analysis, playerNames, onPickPair, onClose }: MatrixDialogProps) {
  const matrix = result.matrix!;
  // Machine choice ids arrived with cache v13; older cached results render the values read-only.
  const clickable = !!onPickPair && !!matrix.p1Choices && !!matrix.p2Choices;
  const marks = matrixMarks(result, matrix, analysis);
  return (
    <ModalDialog title={`Turn ${analysis.turn} · ${playerNames[0]}'s choices against ${playerNames[1]}'s`} closeLabel="Close matrix" onClose={onClose} maxWidth={1100}>
      <div style={{ overflow: 'auto', maxHeight: 'calc(80 * var(--ps-vh) - 150px)' }}>
        <MatrixTable
          matrix={matrix} playerNames={playerNames} faintedFraction={analysis.faintedFraction} marks={marks} dialog clickable={clickable}
          onPickPair={onPickPair && ((p1, p2) => { onClose(); onPickPair(p1, p2); })}
        />
      </div>
      <p style={{ margin: '8px 0 0', fontSize: 11, color: '#9fb2cc' }}>
        Cells: {playerNames[0]}'s chance to win for that pair. Headers: how often the engine expects each choice (its equilibrium).
      </p>
      <p style={{ margin: '4px 0 0', fontSize: 11, color: '#9fb2cc' }}>
        The outlined row and column are what each player chose. engine marks the engine's best choice, worst the reply that hurts a played choice most.
        {clickable ? ' A cell plays that pair out in a branch.' : ''}
      </p>
    </ModalDialog>
  );
}

/**
 * The turn card's "Open matrix" button with its dialog; absent where the turn's result holds no matrix (a search that kept none, an older
 * cache). The overview keeps its own "Matrix" toggle.
 */
export function MatrixDialogButton({ result, analysis, playerNames, onPickPair }: Omit<MatrixDialogProps, 'result' | 'onClose'> & { result: EvalResult | null | undefined }) {
  const [open, setOpen] = useState(false);
  if (!result?.matrix) return null;
  return (
    <>
      <button
        type="button"
        className="ps-btn ps-eval-inline-btn"
        aria-haspopup="dialog"
        title="Read this turn's matrix in a dialog: every pair of choices at its win probability, with the played and the engine's choices marked"
        onClick={() => setOpen(true)}
      >
        Open matrix
      </button>
      {open && createPortal(
        <MatrixDialog result={result} analysis={analysis} playerNames={playerNames} onPickPair={onPickPair} onClose={() => setOpen(false)} />,
        document.body,
      )}
    </>
  );
}
