import type { TurnSnapshot, SideId } from '@fulllifegames/replay-core';
import type { BranchSlotChoice, DiceReport, SimPokemonInfo } from '@fulllifegames/eval-engine';
import type { DieLine } from './branch-dice-lines';
import type { DiceMarks } from './branch-dice-marks';
import { interludesAfter, isInterlude } from './variation-turns';

export interface BranchHistoryEntry {
  turnNumber: number;
  /** 'forced' entries record single-side forced-switch interludes (B15). */
  kind?: 'turn' | 'forced';
  forcedSide?: SideId;
  /** Turn-0 lead entry: the chosen leads (slot order; with `bring`, the
   *  whole brought selection), so a rebuild can re-seed them. */
  leadChoices?: { p1: string[]; p2: string[]; bring?: boolean };
  /** Identity-based choices used to replay this entry after a team edit (B1). */
  p1SlotChoices?: (BranchSlotChoice | null)[];
  p2SlotChoices?: (BranchSlotChoice | null)[];
  /**
   * Round 82 (forced dice): what the simulator did with the dice the user forced in this turn (the dice ride on the slot
   * choices above). A turn that paused for a switch holds its dice in two entries: the forced replacement that finishes the
   * turn carries the report that joins both parts. Absent for a turn without a forced die.
   */
  diceReport?: DiceReport;
  /**
   * Round 82 (forced dice), step A7b: the display lines of that report (decision 6a), placed in the shown log by index. The frame
   * log puts them in; the battle's own log never holds them. A rebuild writes them again with the report.
   */
  dieLines?: DieLine[];
  /**
   * Round 82 (forced dice), step A7c: the labels of the report's dice by side, for the history row and the share link, named with the
   * battle's words when the turn played (the entry has no battle later). A rebuild writes them again with the report.
   */
  diceMarks?: DiceMarks;
  /** The resolved commands actually sent to the sim (display/share only). */
  p1Choice: string;
  p2Choice: string;
  /** Serialized position AFTER this entry executed (unified timeline);
   *  null when capture failed — navigation still works via the sim log. */
  serializedPosition?: string | null;
  p1Active: SimPokemonInfo | null;
  p1ActiveSlots: (SimPokemonInfo | null)[];
  p2Active: SimPokemonInfo | null;
  p2ActiveSlots: (SimPokemonInfo | null)[];
  p1Pokemon: SimPokemonInfo[];
  p2Pokemon: SimPokemonInfo[];
}

/** "Shinyhead (Toxtricity)" — nickname and species together so the original
 *  and branch columns stay comparable (G11). The history rows, the switch
 *  buttons and the choice picker all read this one rule; a body without a
 *  nickname shows its species alone. */
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
  /** The entry that holds the board at `variationTurn`: the row's own entry,
   *  or the last forced replacement that follows it (a pivot or a knock-out
   *  settles after the turn). */
  settled: BranchHistoryEntry;
}

/**
 * Forced-switch interludes are recorded as their own entries (B15) but must
 * not shift the turn-by-turn alignment with the original replay. Round 88 (T348): an interlude on both sides is one of them
 * (`isInterlude`, the one rule of which entries make a turn).
 * `variationTurn` is the position AFTER the row's move — where clicking the
 * branch column navigates (the notation reads "this move led here"). That
 * position includes the forced replacements that follow the turn, so the
 * row's cell reads the board from `settled`.
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
