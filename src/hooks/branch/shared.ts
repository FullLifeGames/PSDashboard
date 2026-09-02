import type { BattleStreams } from '@pkmn/sim';
import type { BranchChoiceErrorLog, BranchSimState, SimPokemonInfo } from '../../lib/branch-engine';
import {
  branchSideChoicesReady,
  requiredChoicesForActiveSlots,
  type BranchSlotChoice,
} from '../../lib/branch-choices';

export type SideId = 'p1' | 'p2';
export type BattleStream = BattleStreams.BattleStream;
export type PlayerStreams = ReturnType<typeof BattleStreams.getPlayerStreams>;
export type BranchEngineModule = typeof import('../../lib/branch-engine');
export type LiveBattle = NonNullable<BattleStream['battle']>;

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

/** The mutable runtime the branch hook owns: the sim streams, its log, and the pending choices. */
export interface BranchRefs {
  // Concurrent sim writes commit unintended extra turns and desync the UI
  // from the battle (double clicks, rapid forced-switch clicks) — one execute
  // may run at a time.
  executingRef: React.RefObject<boolean>;
  branchEngineRef: React.RefObject<BranchEngineModule | null>;
  streamsRef: React.RefObject<PlayerStreams | null>;
  battleStreamRef: React.RefObject<BattleStream | null>;
  logRef: React.RefObject<string[]>;
  choiceErrorsRef: React.RefObject<BranchChoiceErrorLog | null>;
  p1ChoicesRef: React.RefObject<(BranchSlotChoice | null)[]>;
  p2ChoicesRef: React.RefObject<(BranchSlotChoice | null)[]>;
}

/** The state cells the execute and session sides write. */
export interface BranchSetters {
  setSimState: React.Dispatch<React.SetStateAction<BranchSimState | null>>;
  setHistory: React.Dispatch<React.SetStateAction<BranchHistoryEntry[]>>;
  setExecuteError: React.Dispatch<React.SetStateAction<string | null>>;
  setExecuting: React.Dispatch<React.SetStateAction<boolean>>;
}

export function sideIndex(side: SideId): 0 | 1 {
  return side === 'p1' ? 0 : 1;
}

export function forceSwitches(battle: LiveBattle, side: SideId): boolean[] {
  const sideState = battle.sides[sideIndex(side)];
  return sideState.active.map((_, index) => sideState.activeRequest?.forceSwitch?.[index] ?? false);
}

export function requiredChoices(battle: LiveBattle, side: SideId): boolean[] {
  const sideState = battle.sides[sideIndex(side)];
  const forced = forceSwitches(battle, side);
  return requiredChoicesForActiveSlots(sideState.active, forced);
}

export function hasAllChoices(
  battle: LiveBattle,
  side: SideId,
  choices: (BranchSlotChoice | null)[],
): boolean {
  return branchSideChoicesReady(choices, requiredChoices(battle, side));
}

export function makeHistoryEntry(
  turnNumber: number,
  p1Choice: string,
  p2Choice: string,
  nextState: BranchSimState,
): BranchHistoryEntry {
  return {
    turnNumber,
    p1Choice,
    p2Choice,
    p1Active: nextState.p1Active,
    p1ActiveSlots: nextState.p1ActiveSlots,
    p2Active: nextState.p2Active,
    p2ActiveSlots: nextState.p2ActiveSlots,
    p1Pokemon: nextState.p1Pokemon,
    p2Pokemon: nextState.p2Pokemon,
  };
}
