import { useState } from 'react';
import type { EvalMatrix } from '@fulllifegames/eval-engine';
import { MatrixTable } from './eval/MatrixTable';

interface EvalMatrixViewProps {
  matrix: EvalMatrix;
  playerNames: [string, string];
  /** Click a cell: play EXACTLY this pair out in a branch. */
  onPickPair?: (
    p1: { choice: string; label: string },
    p2: { choice: string; label: string },
  ) => void;
  /** Round 69 (T51): the fainted share of the shown turn, for the cells' percents. */
  faintedFraction?: number | null;
}

/**
 * The solved matrix behind the ranked lists: every (own choice × opposing
 * reply) pair at its win probability, equilibrium mixes on the headers.
 * Collapsed by default — it answers "what would X into Y look like?"
 * (draft T48: Shadow Ball → Knock Off), and a cell click plays exactly that
 * pair out instead of the engine's reply.
 */
export function EvalMatrixView({ matrix, playerNames, onPickPair, faintedFraction }: EvalMatrixViewProps) {
  const [open, setOpen] = useState(false);
  // Machine choice ids arrived with cache v13 — older cached results render
  // the values read-only.
  const clickable = !!onPickPair && !!matrix.p1Choices && !!matrix.p2Choices;

  return (
    <div style={{ marginTop: 4 }}>
      <button
        type="button"
        className="ps-btn ps-eval-matrix-toggle"
        style={{ padding: '1px 6px', fontSize: 10 }}
        onClick={() => setOpen(previous => !previous)}
        title={'The full choice-vs-choice matrix behind the rankings: every pair at its win probability. ' +
          'Header percentages are the equilibrium mixes.' +
          (clickable ? ' Click any cell to play exactly that pair out in a branch.' : '')}
      >
        {open ? 'Hide matrix' : 'Matrix'}
      </button>
      {open && (
        <div style={{ overflowX: 'auto', marginTop: 4 }}>
          <MatrixTable matrix={matrix} playerNames={playerNames} onPickPair={onPickPair} clickable={clickable} faintedFraction={faintedFraction} />
        </div>
      )}
    </div>
  );
}
