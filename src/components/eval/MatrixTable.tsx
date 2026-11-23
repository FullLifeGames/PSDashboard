import { type EvalMatrix, winPercent } from '@fulllifegames/eval-engine';
import type { MatrixMarks } from '../../lib/matrix-marks';

export interface MatrixTableProps {
  matrix: EvalMatrix;
  playerNames: [string, string];
  onPickPair?: (
    p1: { choice: string; label: string },
    p2: { choice: string; label: string },
  ) => void;
  faintedFraction?: number | null;
  /** Cells play their pair out (a handler, and choice ids on both axes: results cached before the ids existed stay read-only). */
  clickable: boolean;
  /** The dialog's view: bigger text, labels that wrap, sticky headers, every weight, and these marks. The overview passes neither. */
  dialog?: boolean;
  marks?: MatrixMarks;
}

const cellTint = (value: number) => {
  const strength = Math.min(1, Math.abs(value)) * 0.45;
  return value >= 0
    ? `rgba(136, 170, 204, ${strength.toFixed(3)})`
    : `rgba(204, 136, 170, ${strength.toFixed(3)})`;
};

const inlineHeaderStyle: React.CSSProperties = {
  padding: '2px 4px', fontWeight: 'normal', color: '#aab', textAlign: 'left',
  maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};

/** The dialog's header cells hold the dialog's own background so the cells that scroll under them do not show through. */
const DIALOG_BACKGROUND = '#2a3a5c';
const dialogHeaderStyle: React.CSSProperties = {
  padding: '3px 6px', fontWeight: 'normal', color: '#cde', textAlign: 'left', verticalAlign: 'top',
  background: DIALOG_BACKGROUND, position: 'sticky', overflowWrap: 'anywhere',
};

const mixBadge = (mix: number | undefined) =>
  mix !== undefined && mix >= 0.005 ? ` ${Math.round(mix * 100)}%` : '';
const weightText = (mix: number | undefined) => `${Math.round((mix ?? 0) * 100)}%`;

const sameCell = (at: readonly [number, number] | null | undefined, i: number, j: number) => !!at && at[0] === i && at[1] === j;

const ACCENT = 'var(--ps-accent)';
const WARM = 'var(--ps-accent-warm)';
const DANGER = 'var(--ps-danger)';
/** The tag colour of "worst": the app's light red (misplay and error text), readable on the dialog's blue where --ps-danger is not. */
const DANGER_TEXT = '#f3a6a6';

function playedOutline(row: boolean, column: boolean): string | undefined {
  const lines = [
    ...(row ? [`inset 0 2px 0 ${ACCENT}`, `inset 0 -2px 0 ${ACCENT}`] : []),
    ...(column ? [`inset 2px 0 0 ${ACCENT}`, `inset -2px 0 0 ${ACCENT}`] : []),
  ];
  return lines.length ? lines.join(', ') : undefined;
}

const tagStyle = (color: string): React.CSSProperties => ({
  display: 'inline-block', border: `1px solid ${color}`, color, borderRadius: 3, padding: '0 3px', fontSize: 9, lineHeight: '13px',
});

function HeaderTags({ mix, played, best }: { mix: number | undefined; played: boolean; best: boolean }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 2, alignItems: 'center' }}>
      <span style={{ color: '#9fb2cc', fontSize: 10 }} title="How often the engine expects this choice (its equilibrium weight)">{weightText(mix)}</span>
      {played && <span style={tagStyle(ACCENT)}>played</span>}
      {best && <span style={tagStyle(WARM)}>engine</span>}
    </div>
  );
}

function cellTitle(props: MatrixTableProps & { i: number; j: number; pct: number }, worst: { p1: boolean; p2: boolean }): string {
  const { matrix, playerNames, clickable, i, j, pct } = props;
  const worstP1 = worst.p1 ? `The worst reply to ${playerNames[0]}'s ${matrix.p1Labels[i]}` : '';
  const worstP2 = worst.p2 ? `${worst.p1 ? 'and' : 'The'} worst reply to ${playerNames[1]}'s ${matrix.p2Labels[j]}` : '';
  const notes = [worstP1, worstP2].filter(Boolean).join(', ');
  return `${matrix.p1Labels[i]} × ${matrix.p2Labels[j]}: ${playerNames[0]} ${pct}% · ${playerNames[1]} ${100 - pct}%` +
    (notes ? `. ${notes}` : '') + (clickable ? '. Click to play exactly this pair out.' : '');
}

function MatrixCell(props: MatrixTableProps & { i: number; j: number; value: number }) {
  const { matrix, onPickPair, clickable, i, j, value, marks, dialog } = props;
  const pct = winPercent(value, props.faintedFraction);
  const worst = { p1: sameCell(marks?.worstP1, i, j), p2: sameCell(marks?.worstP2, i, j) };
  const isWorst = worst.p1 || worst.p2;
  const title = cellTitle({ ...props, pct }, worst);
  const cellStyle: React.CSSProperties = {
    padding: dialog ? '3px 4px' : '1px 2px', textAlign: 'center', background: cellTint(value),
    border: '1px solid rgba(255,255,255,0.06)', color: '#cde', minWidth: dialog ? 44 : 30,
    boxShadow: playedOutline(marks?.playedRow === i, marks?.playedColumn === j),
    ...(isWorst ? { outline: `2px dashed ${DANGER}`, outlineOffset: -3 } : {}),
  };
  const content = (
    <>
      {pct}%
      {isWorst && <span style={{ display: 'block', marginTop: 2 }}><span style={tagStyle(DANGER_TEXT)}>worst</span></span>}
    </>
  );
  if (!clickable) {
    return <td style={cellStyle} title={title}>{content}</td>;
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
        {content}
      </button>
    </td>
  );
}

function ColumnHeader({ matrix, playerNames, j, marks, dialog }: Pick<MatrixTableProps, 'matrix' | 'playerNames' | 'marks' | 'dialog'> & { j: number }) {
  const label = matrix.p2Labels[j];
  const title = `${playerNames[1]}: ${label} · equilibrium weight ${Math.round((matrix.mixes.p2[j] ?? 0) * 100)}%`;
  if (!dialog) {
    return (
      <th scope="col" style={inlineHeaderStyle} title={title}>
        {label}
        <span style={{ color: '#778' }}>{mixBadge(matrix.mixes.p2[j])}</span>
      </th>
    );
  }
  return (
    <th
      scope="col" title={title}
      style={{ ...dialogHeaderStyle, top: 0, zIndex: 2, minWidth: 96, maxWidth: 150, boxShadow: marks?.playedColumn === j ? `inset 0 -2px 0 ${ACCENT}` : undefined }}
    >
      <div>{label}</div>
      <HeaderTags mix={matrix.mixes.p2[j]} played={marks?.playedColumn === j} best={marks?.bestColumn === j} />
    </th>
  );
}

function RowHeader({ matrix, playerNames, i, marks, dialog }: Pick<MatrixTableProps, 'matrix' | 'playerNames' | 'marks' | 'dialog'> & { i: number }) {
  const label = matrix.p1Labels[i];
  const title = `${playerNames[0]}: ${label} · equilibrium weight ${Math.round((matrix.mixes.p1[i] ?? 0) * 100)}%`;
  if (!dialog) {
    return (
      <th scope="row" style={inlineHeaderStyle} title={title}>
        {label}
        <span style={{ color: '#778' }}>{mixBadge(matrix.mixes.p1[i])}</span>
      </th>
    );
  }
  return (
    <th
      scope="row" title={title}
      style={{ ...dialogHeaderStyle, left: 0, zIndex: 1, minWidth: 150, maxWidth: 220, boxShadow: marks?.playedRow === i ? `inset -2px 0 0 ${ACCENT}` : undefined }}
    >
      <div>{label}</div>
      <HeaderTags mix={matrix.mixes.p1[i]} played={marks?.playedRow === i} best={marks?.bestRow === i} />
    </th>
  );
}

/** The payoff table of the overview (10 px) and of the dialog: every (own choice × opposing reply) pair at its win probability for the first player, equilibrium weights on the headers. */
export function MatrixTable(props: MatrixTableProps) {
  const { matrix, playerNames, marks, dialog } = props;
  return (
    <table style={{ borderCollapse: 'collapse', fontSize: dialog ? 11 : 10 }}>
      <thead>
        <tr>
          <th
            scope="col"
            style={dialog ? { ...dialogHeaderStyle, top: 0, left: 0, zIndex: 3, minWidth: 150, color: '#9fb2cc' } : inlineHeaderStyle}
            title={`Rows: ${playerNames[0]} · columns: ${playerNames[1]}. Cells: ${playerNames[0]}'s win probability for that pair.`}
          >
            {playerNames[0]} \ {playerNames[1]}
          </th>
          {matrix.p2Labels.map((_, j) => (
            <ColumnHeader key={`c${j}`} matrix={matrix} playerNames={playerNames} j={j} marks={marks} dialog={dialog} />
          ))}
        </tr>
      </thead>
      <tbody>
        {matrix.values.map((row, i) => (
          <tr key={`r${i}`}>
            <RowHeader matrix={matrix} playerNames={playerNames} i={i} marks={marks} dialog={dialog} />
            {row.map((value, j) => (
              <MatrixCell key={`v${i}-${j}`} {...props} i={i} j={j} value={value} />
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
