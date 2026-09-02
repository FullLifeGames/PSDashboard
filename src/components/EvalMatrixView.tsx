import { useState } from 'react';
import { type EvalMatrix, winPercent } from '@fulllifegames/eval-engine';

interface EvalMatrixViewProps {
  matrix: EvalMatrix;
  playerNames: [string, string];
  /** Click a cell: play EXACTLY this pair out in a branch. */
  onPickPair?: (
    p1: { choice: string; label: string },
    p2: { choice: string; label: string },
  ) => void;
}

/** Cell tint leans toward whoever the cell favors, stronger when decisive. */
const cellTint = (value: number) => {
  const strength = Math.min(1, Math.abs(value)) * 0.45;
  return value >= 0
    ? `rgba(136, 170, 204, ${strength.toFixed(3)})`
    : `rgba(204, 136, 170, ${strength.toFixed(3)})`;
};

const headerStyle: React.CSSProperties = {
  padding: '2px 4px', fontWeight: 'normal', color: '#aab', textAlign: 'left',
  maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};

const mixBadge = (mix: number | undefined) =>
  mix !== undefined && mix >= 0.005 ? ` ${Math.round(mix * 100)}%` : '';

interface TableProps extends EvalMatrixViewProps {
  clickable: boolean;
}

function MatrixCell({ matrix, playerNames, onPickPair, clickable, i, j, value }: TableProps & { i: number; j: number; value: number }) {
  const pct = winPercent(value);
  const title = `${matrix.p1Labels[i]} × ${matrix.p2Labels[j]}: ` +
    `${playerNames[0]} ${pct}% · ${playerNames[1]} ${100 - pct}%` +
    (clickable ? '. Click to play exactly this pair out.' : '');
  const cellStyle: React.CSSProperties = {
    padding: '1px 2px', textAlign: 'center', background: cellTint(value),
    border: '1px solid rgba(255,255,255,0.06)', color: '#cde', minWidth: 30,
  };
  if (!clickable) {
    return <td style={cellStyle} title={title}>{pct}%</td>;
  }
  return (
    <td style={{ padding: 0 }}>
      <button
        type="button"
        className="ps-btn"
        style={{ ...cellStyle, width: '100%', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 0 }}
        title={title}
        onClick={() => onPickPair!(
          { choice: matrix.p1Choices![i], label: matrix.p1Labels[i] },
          { choice: matrix.p2Choices![j], label: matrix.p2Labels[j] },
        )}
      >
        {pct}%
      </button>
    </td>
  );
}

function MatrixTable(props: TableProps) {
  const { matrix, playerNames } = props;
  return (
    <table style={{ borderCollapse: 'collapse', fontSize: 10 }}>
      <thead>
        <tr>
          <th style={headerStyle} title={`Rows: ${playerNames[0]} · columns: ${playerNames[1]}. Cells: ${playerNames[0]}'s win probability for that pair.`}>
            {playerNames[0]} \ {playerNames[1]}
          </th>
          {matrix.p2Labels.map((label, j) => (
            <th key={`c${j}`} style={headerStyle} title={`${playerNames[1]}: ${label} · equilibrium weight ${Math.round((matrix.mixes.p2[j] ?? 0) * 100)}%`}>
              {label}
              <span style={{ color: '#778' }}>{mixBadge(matrix.mixes.p2[j])}</span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {matrix.values.map((row, i) => (
          <tr key={`r${i}`}>
            <th style={headerStyle} title={`${playerNames[0]}: ${matrix.p1Labels[i]} · equilibrium weight ${Math.round((matrix.mixes.p1[i] ?? 0) * 100)}%`}>
              {matrix.p1Labels[i]}
              <span style={{ color: '#778' }}>{mixBadge(matrix.mixes.p1[i])}</span>
            </th>
            {row.map((value, j) => (
              <MatrixCell key={`v${i}-${j}`} {...props} i={i} j={j} value={value} />
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * The solved matrix behind the ranked lists: every (own choice × opposing
 * reply) pair at its win probability, equilibrium mixes on the headers.
 * Collapsed by default — it answers "what would X into Y look like?"
 * (draft T48: Shadow Ball → Knock Off), and a cell click plays exactly that
 * pair out instead of the engine's reply.
 */
export function EvalMatrixView({ matrix, playerNames, onPickPair }: EvalMatrixViewProps) {
  const [open, setOpen] = useState(false);
  // Machine choice ids arrived with cache v13 — older cached results render
  // the values read-only.
  const clickable = !!onPickPair && !!matrix.p1Choices && !!matrix.p2Choices;

  return (
    <div style={{ marginTop: 4 }}>
      <button
        type="button"
        className="ps-btn"
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
          <MatrixTable matrix={matrix} playerNames={playerNames} onPickPair={onPickPair} clickable={clickable} />
        </div>
      )}
    </div>
  );
}
