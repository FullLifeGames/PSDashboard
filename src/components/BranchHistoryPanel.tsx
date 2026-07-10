import type { TurnSnapshot } from '../types';
import type { BranchHistoryEntry } from '../hooks/useBranch';

interface Props {
  branchStartTurn: number;
  history: BranchHistoryEntry[];
  snapshots: TurnSnapshot[];
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
 */
function alignHistoryRows(history: BranchHistoryEntry[], branchStartTurn: number) {
  let turnIndex = 0;
  return history.map(entry => {
    const isForced = entry.kind === 'forced';
    if (!isForced) turnIndex += 1;
    return { entry, originalTurn: isForced ? null : branchStartTurn + turnIndex };
  });
}

export function BranchHistoryPanel({ branchStartTurn, history, snapshots }: Props) {
  const rows = alignHistoryRows(history, branchStartTurn);
  return (
    <div className="ps-panel" style={{ marginTop: 8, flex: '0 0 auto' }}>
      <div style={{ fontSize: 13, fontWeight: 'bold', marginBottom: 8 }}>Branch History</div>
      {history.length === 0 && (
        <div style={{ fontSize: 11, color: '#8899aa' }}>
          Execute turns to compare the original replay line with your branch.
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map(({ entry, originalTurn }, index) => {
            if (entry.kind === 'forced' || originalTurn === null) {
              const forcedChoice = entry.forcedSide === 'p1' ? entry.p1Choice : entry.p2Choice;
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
                  Turn {entry.turnNumber} — forced replacement ({entry.forcedSide?.toUpperCase()}): {forcedChoice}
                </div>
              );
            }

            const originalSnapshot = snapshots.find(snapshot => snapshot.turn === originalTurn) || null;
            const original = activeSummary(originalSnapshot);
            const branch = branchSummary(entry);

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
                <span style={{ fontSize: 10, color: '#9fb5d9' }}>
                  P1 {entry.p1Choice} | P2 {entry.p2Choice}
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div style={{ fontSize: 11 }}>
                  <div style={{ color: '#8899aa', marginBottom: 3 }}>Original replay (turn {originalTurn})</div>
                  <div>P1: {original.p1}</div>
                  <div>P2: {original.p2}</div>
                </div>
                <div style={{ fontSize: 11 }}>
                  <div style={{ color: '#8899aa', marginBottom: 3 }}>Branch result</div>
                  <div>P1: {branch.p1}</div>
                  <div>P2: {branch.p2}</div>
                </div>
              </div>
            </div>
            );
        })}
      </div>
    </div>
  );
}
