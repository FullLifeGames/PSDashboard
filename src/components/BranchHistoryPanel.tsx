import type { TurnSnapshot } from '../types';
import type { BranchHistoryEntry } from '../hooks/useBranch';
import { notationSideLabel } from '../lib/branch-choices';
import type { TimelinePosition } from '../lib/timeline';

interface Props {
  branchStartTurn: number;
  history: BranchHistoryEntry[];
  snapshots: TurnSnapshot[];
  /** The timeline pointer — the matching cell renders highlighted. */
  currentPosition?: TimelinePosition;
  /** Clicking a cell navigates there, naming its line explicitly. */
  onNavigate?: (position: TimelinePosition) => void;
}

/** "Shinyhead (Toxtricity)" — nickname and species together so the original
 *  and branch columns stay comparable (G11). */
function displayName(name: string, species: string): string {
  if (!name || name === species) return species || name;
  return `${name} (${species})`;
}

function activeSummary(snapshot: TurnSnapshot | null) {
  if (!snapshot) return { p1: 'No replay state', p2: 'No replay state' };
  const p1Active = snapshot.p1.pokemon.filter(pokemon => pokemon.isActive);
  const p2Active = snapshot.p2.pokemon.filter(pokemon => pokemon.isActive);

  return {
    p1: p1Active.length > 0 ? p1Active.map(pokemon => `${displayName(pokemon.name, pokemon.speciesForme)} ${pokemon.hpPercent}%`).join(' / ') : 'Empty',
    p2: p2Active.length > 0 ? p2Active.map(pokemon => `${displayName(pokemon.name, pokemon.speciesForme)} ${pokemon.hpPercent}%`).join(' / ') : 'Empty',
  };
}

function branchSummary(entry: BranchHistoryEntry) {
  const p1Active = entry.p1ActiveSlots.length > 0 ? entry.p1ActiveSlots : [entry.p1Active];
  const p2Active = entry.p2ActiveSlots.length > 0 ? entry.p2ActiveSlots : [entry.p2Active];

  return {
    p1: p1Active.filter(Boolean).map(active => `${displayName(active!.name, active!.species)} ${active!.hpPercent}%`).join(' / ') || 'Empty',
    p2: p2Active.filter(Boolean).map(active => `${displayName(active!.name, active!.species)} ${active!.hpPercent}%`).join(' / ') || 'Empty',
  };
}

/**
 * Forced-switch interludes are recorded as their own entries (B15) but must
 * not shift the turn-by-turn alignment with the original replay.
 * `variationTurn` is the position AFTER the row's move — where clicking the
 * branch column navigates (the notation reads "this move led here").
 */
function alignHistoryRows(history: BranchHistoryEntry[], branchStartTurn: number) {
  let turnIndex = 0;
  return history.map(entry => {
    const isForced = entry.kind === 'forced';
    if (!isForced) turnIndex += 1;
    return {
      entry,
      originalTurn: isForced ? null : branchStartTurn + turnIndex,
      variationTurn: isForced ? null : branchStartTurn + turnIndex,
    };
  });
}

const cellReset = {
  all: 'unset' as const,
  display: 'block' as const,
  cursor: 'pointer' as const,
  width: '100%',
  boxSizing: 'border-box' as const,
};

export function BranchHistoryPanel({ branchStartTurn, history, snapshots, currentPosition, onNavigate }: Props) {
  const rows = alignHistoryRows(history, branchStartTurn);
  const turnEntries = history.filter(entry => entry.kind !== 'forced').length;
  const tipTurn = branchStartTurn + turnEntries;
  return (
    <div className="ps-panel" style={{ marginTop: 8, flex: '0 0 auto' }}>
      <div style={{ fontSize: 13, fontWeight: 'bold', marginBottom: 8 }}>
        Variation moves
        {onNavigate && history.length > 0 && (
          <span style={{ fontWeight: 'normal', fontSize: 10, color: '#8899aa', marginLeft: 8 }}>
            click a cell to jump: left opens the main line, right the variation
          </span>
        )}
      </div>
      {history.length === 0 && (
        <div style={{ fontSize: 11, color: '#8899aa' }}>
          Execute turns to compare the original replay line with your branch.
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map(({ entry, originalTurn, variationTurn }, index) => {
            if (entry.kind === 'forced' || originalTurn === null || variationTurn === null) {
              const forcedChoice = entry.forcedSide === 'p1'
                ? notationSideLabel(entry.p1SlotChoices, entry.p1Choice)
                : notationSideLabel(entry.p2SlotChoices, entry.p2Choice);
              return (
                <div
                  key={`forced-${entry.turnNumber}-${index}`}
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

            const originalSnapshot = snapshots.find(snapshot => snapshot.turn === originalTurn) || null;
            const original = activeSummary(originalSnapshot);
            const branch = branchSummary(entry);
            const onMainCell = currentPosition?.line === 'main' && currentPosition.turn === originalTurn;
            const onVariationCell = currentPosition?.line === 'variation' && currentPosition.turn === variationTurn;

            return (
            <div
              key={`${entry.turnNumber}-${index}`}
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
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <button
                  type="button"
                  onClick={onNavigate ? () => onNavigate({ turn: originalTurn, line: 'main' }) : undefined}
                  style={{
                    ...cellReset,
                    fontSize: 11,
                    borderRadius: 4,
                    padding: 3,
                    outline: onMainCell ? '1px solid #7cb7e8' : undefined,
                    cursor: onNavigate ? 'pointer' : 'default',
                  }}
                >
                  <div style={{ color: '#8899aa', marginBottom: 3 }}>Main line (turn {originalTurn})</div>
                  <div>P1: {original.p1}</div>
                  <div>P2: {original.p2}</div>
                </button>
                <button
                  type="button"
                  onClick={onNavigate ? () => onNavigate({ turn: variationTurn, line: 'variation' }) : undefined}
                  style={{
                    ...cellReset,
                    fontSize: 11,
                    borderRadius: 4,
                    padding: 3,
                    outline: onVariationCell ? '1px solid #f0c76b' : undefined,
                    cursor: onNavigate ? 'pointer' : 'default',
                  }}
                >
                  <div style={{ color: '#8899aa', marginBottom: 3 }}>Variation result</div>
                  <div>P1: {branch.p1}</div>
                  <div>P2: {branch.p2}</div>
                </button>
              </div>
            </div>
            );
        })}
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
            Tip of the variation: continue playing here
          </button>
        )}
      </div>
    </div>
  );
}
