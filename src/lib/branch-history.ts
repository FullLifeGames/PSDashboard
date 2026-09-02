import type { TurnSnapshot } from '../types';
import type { BranchHistoryEntry } from '../hooks/useBranch';

/** "Shinyhead (Toxtricity)" — nickname and species together so the original
 *  and branch columns stay comparable (G11). */
function displayName(name: string, species: string): string {
  if (!name || name === species) return species || name;
  return `${name} (${species})`;
}

export interface SideSummary {
  p1: string;
  p2: string;
}

export function activeSummary(snapshot: TurnSnapshot | null): SideSummary {
  if (!snapshot) return { p1: 'No replay state', p2: 'No replay state' };
  const p1Active = snapshot.p1.pokemon.filter(pokemon => pokemon.isActive);
  const p2Active = snapshot.p2.pokemon.filter(pokemon => pokemon.isActive);

  return {
    p1: p1Active.length > 0 ? p1Active.map(pokemon => `${displayName(pokemon.name, pokemon.speciesForme)} ${pokemon.hpPercent}%`).join(' / ') : 'Empty',
    p2: p2Active.length > 0 ? p2Active.map(pokemon => `${displayName(pokemon.name, pokemon.speciesForme)} ${pokemon.hpPercent}%`).join(' / ') : 'Empty',
  };
}

export function branchSummary(entry: BranchHistoryEntry): SideSummary {
  const p1Active = entry.p1ActiveSlots.length > 0 ? entry.p1ActiveSlots : [entry.p1Active];
  const p2Active = entry.p2ActiveSlots.length > 0 ? entry.p2ActiveSlots : [entry.p2Active];

  return {
    p1: p1Active.filter(Boolean).map(active => `${displayName(active!.name, active!.species)} ${active!.hpPercent}%`).join(' / ') || 'Empty',
    p2: p2Active.filter(Boolean).map(active => `${displayName(active!.name, active!.species)} ${active!.hpPercent}%`).join(' / ') || 'Empty',
  };
}

export interface HistoryRowAlignment {
  entry: BranchHistoryEntry;
  originalTurn: number | null;
  variationTurn: number | null;
}

/**
 * Forced-switch interludes are recorded as their own entries (B15) but must
 * not shift the turn-by-turn alignment with the original replay.
 * `variationTurn` is the position AFTER the row's move — where clicking the
 * branch column navigates (the notation reads "this move led here").
 */
export function alignHistoryRows(history: BranchHistoryEntry[], branchStartTurn: number): HistoryRowAlignment[] {
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
