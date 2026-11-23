import type { TurnSnapshot, SideId } from '@fulllifegames/replay-core';
import type { BranchSlotChoice, DiceReport, SimPokemonInfo } from '@fulllifegames/eval-engine';
import type { DieLine } from './branch-dice-lines';
import type { DiceMarks } from './branch-dice-marks';
import { interludesAfter, isInterlude } from './variation-turns';

export interface BranchHistoryEntry {
  turnNumber: number;
  /** 'forced': a single-side forced-switch interlude, recorded as its own entry. */
  kind?: 'turn' | 'forced';
  forcedSide?: SideId;
  /** Turn-0 lead entry: the chosen leads (slot order; with `bring`, the whole brought selection). */
  leadChoices?: { p1: string[]; p2: string[]; bring?: boolean };
  /** Identity-based choices that replay this entry after a team edit. */
  p1SlotChoices?: (BranchSlotChoice | null)[];
  p2SlotChoices?: (BranchSlotChoice | null)[];
  /**
   * What the simulator did with the dice forced in this turn. A turn that paused for a switch holds its dice in two entries: the forced
   * replacement that finishes the turn carries the report that joins both parts.
   */
  diceReport?: DiceReport;
  /** The display lines of that report, placed in the shown log by index; the battle's own log never holds them. */
  dieLines?: DieLine[];
  /** The labels of the report's dice by side, named with the battle's words when the turn played (the entry has no battle later). */
  diceMarks?: DiceMarks;
  /** The resolved commands sent to the sim (display and share only). */
  p1Choice: string;
  p2Choice: string;
  /** Serialized position after this entry executed; null when the capture failed (navigation still works via the sim log). */
  serializedPosition?: string | null;
  p1Active: SimPokemonInfo | null;
  p1ActiveSlots: (SimPokemonInfo | null)[];
  p2Active: SimPokemonInfo | null;
  p2ActiveSlots: (SimPokemonInfo | null)[];
  p1Pokemon: SimPokemonInfo[];
  p2Pokemon: SimPokemonInfo[];
}

/** "Shinyhead (Toxtricity)": nickname and species together; a body without a nickname shows its species alone. */
export function displayName(name: string, species: string): string {
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
  /** The entry that holds the board at `variationTurn`: the row's own entry or the last forced replacement after it. */
  settled: BranchHistoryEntry;
}

/**
 * Forced-switch interludes are their own entries and do not shift the alignment with the original replay (`isInterlude` decides which
 * entries make a turn). `variationTurn` is the position after the row's move, including the forced replacements that follow the turn,
 * so the row's cell reads the board from `settled`.
 */
export function alignHistoryRows(history: BranchHistoryEntry[], branchStartTurn: number): HistoryRowAlignment[] {
  let turnIndex = 0;
  return history.map((entry, index) => {
    const interlude = isInterlude(history, index);
    if (!interlude) turnIndex += 1;
    const settled = interlude ? entry : history[index + interludesAfter(history, index)];
    return {
      entry,
      originalTurn: interlude ? null : branchStartTurn + turnIndex,
      variationTurn: interlude ? null : branchStartTurn + turnIndex,
      settled,
    };
  });
}
