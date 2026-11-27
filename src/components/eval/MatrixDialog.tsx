import { useState } from 'react';
import { createPortal } from 'react-dom';
import { winPercent, type EvalResult, type TurnAnalysis } from '@fulllifegames/eval-engine';
import { matrixMarks } from '../../lib/matrix-marks';
import { unlistedFloors } from '../../lib/unlisted-floor';
import { ModalDialog } from '../ModalDialog';
import { MatrixTable } from './MatrixTable';

type PickPair = (p1: { choice: string; label: string }, p2: { choice: string; label: string }) => void;

interface MatrixDialogProps {
  result: EvalResult;
  analysis: TurnAnalysis;
  playerNames: [string, string];
  onPickPair?: PickPair;
  onClose: () => void;
}

const UNLISTED_NOTES_SHOWN = 6;

function MatrixDialog({ result, analysis, playerNames, onPickPair, onClose }: MatrixDialogProps) {
  const matrix = result.matrix!;
  const clickable = !!onPickPair && !!matrix.p1Choices && !!matrix.p2Choices;
  const marks = matrixMarks(result, matrix, analysis);
  const unlisted = unlistedFloors(result);
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
      {unlisted.slice(0, UNLISTED_NOTES_SHOWN).map(({ side, row }) => (
        <p key={`${side}|${row.choice}`} style={{ margin: '4px 0 0', fontSize: 11, color: '#9fb2cc' }}>
          {`${playerNames[side === 'p1' ? 0 : 1]}'s ${row.label}: guaranteed at least ${winPercent(row.worstCase, analysis.faintedFraction)}% against ${row.punishedBy}. `}
          The table lists no column for that reply, so the floor sits below every cell of that choice.
        </p>
      ))}
      {unlisted.length > UNLISTED_NOTES_SHOWN && (
        <p style={{ margin: '4px 0 0', fontSize: 11, color: '#9fb2cc' }}>
          {`${unlisted.length - UNLISTED_NOTES_SHOWN} more choices have a floor from a reply the table does not list.`}
        </p>
      )}
    </ModalDialog>
  );
}

export function MatrixDialogButton({ result, analysis, playerNames, onPickPair }: Omit<MatrixDialogProps, 'result' | 'onClose'> & { result: EvalResult | null | undefined }) {
  const [open, setOpen] = useState(false);
  if (!result?.matrix) return null;
  return (
    <>
      <button
        type="button"
        className="ps-btn ps-eval-inline-btn"
        style={{ padding: '1px 6px', fontSize: 10 }}
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
