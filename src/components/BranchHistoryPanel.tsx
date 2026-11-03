import { useId, useState, type ReactNode } from 'react';
import type { TurnSnapshot } from '@fulllifegames/replay-core';
import type { BranchHistoryEntry } from '../hooks/useBranch';
import { notationSideLabel } from '@fulllifegames/eval-engine';
import type { TimelinePosition } from '../lib/timeline';
import { activeSummary, alignHistoryRows, branchSummary, type SideSummary } from '../lib/branch-history';
import { markText, turnDiceMarks, type DiceMarks } from '../lib/branch-dice-marks';

/**
 * Round 84 (A7i, ruling 20a): what the caller hands the panel. `actions` stand at the right end of the toggle line, `status` under
 * the line (it learns whether the body is open), `saved` in the body under the moves; `onOpenChange` hears each toggle.
 */
export interface BranchHistorySlots {
  actions: ReactNode;
  status: (open: boolean) => ReactNode;
  saved: ReactNode;
  onOpenChange?: (open: boolean) => void;
}

interface Props {
  branchStartTurn: number;
  history: BranchHistoryEntry[];
  snapshots: TurnSnapshot[];
  /** The timeline pointer — the matching cell renders highlighted. */
  currentPosition?: TimelinePosition;
  /** Clicking a cell navigates there, naming its line explicitly. */
  onNavigate?: (position: TimelinePosition) => void;
  /** The live sim has a winner: the tip is an end, not a place to play on (round 77, C7). */
  ended?: boolean;
  slots?: BranchHistorySlots;
}

const cellReset = {
  all: 'unset' as const,
  display: 'block' as const,
  cursor: 'pointer' as const,
  width: '100%',
  boxSizing: 'border-box' as const,
};

function ForcedRow({ entry }: { entry: BranchHistoryEntry }) {
  const forcedChoice = entry.forcedSide === 'p1'
    ? notationSideLabel(entry.p1SlotChoices, entry.p1Choice)
    : notationSideLabel(entry.p2SlotChoices, entry.p2Choice);
  return (
    <div
      style={{
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 6,
        padding: '6px 10px',
        background: 'rgba(0,0,0,0.12)',
        fontSize: 11,
        color: '#9fb5d9',
      }}
    >
      Turn {entry.turnNumber} · forced replacement ({entry.forcedSide?.toUpperCase()}): {forcedChoice}
    </div>
  );
}

/**
 * Round 82 (forced dice), step A7c, decision 6a: the dice the user forced in the row's turn, each with its side, and "(no effect)"
 * on a die the simulator did not use (the reason sits in the title).
 */
function DiceMarksLine({ marks }: { marks: DiceMarks }) {
  const sides = (['p1', 'p2'] as const).flatMap(side => marks[side].map((mark, index) => ({ side, mark, key: `${side}-${index}` })));
  return (
    <div role="group" aria-label="Forced dice" style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 8px', fontSize: 10, color: '#cddcf2', marginBottom: 6 }}>
      <span style={{ color: '#8899aa' }}>Forced dice</span>
      {sides.map(({ side, mark, key }) => (
        <span key={key} title={mark.noEffect || undefined} style={mark.noEffect === undefined ? undefined : { color: '#e0a8a8' }}>
          {`${side.toUpperCase()} ${markText(mark)}`}
        </span>
      ))}
    </div>
  );
}

/** One line's cell of a history row: the heading and both sides' actives; clickable when navigation exists. */
function LineCell({ heading, summary, highlighted, color, onClick }: {
  heading: string;
  summary: SideSummary;
  highlighted: boolean;
  color: string;
  onClick: (() => void) | undefined;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        ...cellReset,
        fontSize: 11,
        borderRadius: 4,
        padding: 3,
        outline: highlighted ? `1px solid ${color}` : undefined,
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <div style={{ color: '#8899aa', marginBottom: 3 }}>{heading}</div>
      <div>P1: {summary.p1}</div>
      <div>P2: {summary.p2}</div>
    </button>
  );
}

function HistoryRow({ entry, settled, marks, originalTurn, variationTurn, snapshots, currentPosition, onNavigate }: Pick<Props, 'snapshots' | 'currentPosition' | 'onNavigate'> & {
  entry: BranchHistoryEntry;
  /** The dice of the whole turn: a turn that paused for a switch reads the joined report of its last forced entry. */
  marks: DiceMarks | undefined;
  /** Holds the board after the turn's forced replacements (A-5). */
  settled: BranchHistoryEntry;
  originalTurn: number;
  variationTurn: number;
}) {
  const originalSnapshot = snapshots.find(snapshot => snapshot.turn === originalTurn) || null;
  const original = activeSummary(originalSnapshot);
  const branch = branchSummary(settled);
  const onMainCell = currentPosition?.line === 'main' && currentPosition.turn === originalTurn;
  const onVariationCell = currentPosition?.line === 'variation' && currentPosition.turn === variationTurn;

  return (
    <div
      style={{
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 6,
        padding: 10,
        background: 'rgba(0,0,0,0.12)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
        <strong style={{ fontSize: 12 }}>Turn {entry.turnNumber}</strong>
        <span style={{ fontSize: 10, color: '#cddcf2' }}>
          {notationSideLabel(entry.p1SlotChoices, entry.p1Choice)}
          <span style={{ color: '#667' }}> | </span>
          {notationSideLabel(entry.p2SlotChoices, entry.p2Choice)}
        </span>
      </div>
      {marks && <DiceMarksLine marks={marks} />}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <LineCell
          heading={`Main line (turn ${originalTurn})`}
          summary={original}
          highlighted={onMainCell}
          color="#7cb7e8"
          onClick={onNavigate ? () => onNavigate({ turn: originalTurn, line: 'main' }) : undefined}
        />
        <LineCell
          heading="Variation result"
          summary={branch}
          highlighted={onVariationCell}
          color="#f0c76b"
          onClick={onNavigate ? () => onNavigate({ turn: variationTurn, line: 'variation' }) : undefined}
        />
      </div>
    </div>
  );
}

/** The open panel's list: one row per executed turn (a forced replacement is its own row) and the tip button. */
function HistoryList({ branchStartTurn, history, snapshots, currentPosition, onNavigate, ended }: Props & { ended: boolean }) {
  const rows = alignHistoryRows(history, branchStartTurn);
  const turnEntries = history.filter(entry => entry.kind !== 'forced').length;
  const tipTurn = branchStartTurn + turnEntries;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map(({ entry, settled, originalTurn, variationTurn }, index) => (
        entry.kind === 'forced' || originalTurn === null || variationTurn === null
          ? <ForcedRow key={`forced-${entry.turnNumber}-${index}`} entry={entry} />
          : (
            <HistoryRow
              key={`${entry.turnNumber}-${index}`}
              entry={entry}
              settled={settled}
              marks={turnDiceMarks(history, index)}
              originalTurn={originalTurn}
              variationTurn={variationTurn}
              snapshots={snapshots}
              currentPosition={currentPosition}
              onNavigate={onNavigate}
            />
          )
      ))}
      {onNavigate && turnEntries > 0 && (
        <button
          type="button"
          onClick={() => onNavigate({ turn: tipTurn, line: 'variation' })}
          style={{
            ...cellReset,
            border: '1px dashed rgba(240,199,107,0.4)',
            borderRadius: 6,
            padding: '6px 10px',
            fontSize: 11,
            color: '#ffeeba',
            background: 'rgba(240,199,107,0.06)',
          }}
        >
          {ended ? 'End of the variation: the game is over here' : 'Tip of the variation: continue playing here'}
        </button>
      )}
    </div>
  );
}

/**
 * Round 84 (A7f, ruling 18a): the panel sits closed under a one-line toggle, like the turn's explanation, so a variation's history no
 * longer pushes the left column under the sticky dock. The caller keys it by the variation's start turn: it starts closed in every
 * variation, keeps the user's setting while that variation lives, and the app stores nothing.
 */
export function BranchHistoryPanel({ ended = false, slots, ...props }: Props) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const { history, onNavigate } = props;
  const turnEntries = history.filter(entry => entry.kind !== 'forced').length;
  const toggle = () => {
    setOpen(!open);
    slots?.onOpenChange?.(!open);
  };
  return (
    <div className="ps-panel" style={{ marginTop: 8, flex: '0 0 auto' }}>
      <div className="ps-history-line">
        <button
          type="button" className="ps-eval-analysis-toggle ps-history-toggle" aria-expanded={open} aria-controls={bodyId}
          onClick={toggle}
        >
          {open ? '▾' : '▸'} Variation moves{turnEntries > 0 && ` · ${turnEntries} ${turnEntries === 1 ? 'turn' : 'turns'}`}
        </button>
        {slots && <span className="ps-history-actions">{slots.actions}</span>}
      </div>
      {slots?.status(open)}
      <div id={bodyId} hidden={!open}>
        {onNavigate && history.length > 0 && (
          <div style={{ fontSize: 10, color: '#8899aa', margin: '6px 0 8px' }}>
            click a cell to jump: left opens the main line, right the variation
          </div>
        )}
        {history.length === 0 && (
          <div style={{ fontSize: 11, color: '#8899aa', marginTop: 6 }}>
            Execute turns to compare the original replay line with your branch.
          </div>
        )}
        <HistoryList {...props} ended={ended} />
        {slots?.saved}
      </div>
    </div>
  );
}
