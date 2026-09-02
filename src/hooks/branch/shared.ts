import type { BattleStreams } from '@pkmn/sim';
import {
  type BranchChoiceErrorLog, type BranchSimState, branchSideChoicesReady, requiredChoicesForActiveSlots,
  type BranchSlotChoice,
} from '@fulllifegames/eval-engine';
import { sideIndex, type SideId } from '@fulllifegames/replay-core';
import type { BranchHistoryEntry } from '../../lib/branch-history';

export type { BranchHistoryEntry };

export type { SideId };
export type BattleStream = BattleStreams.BattleStream;
export type PlayerStreams = ReturnType<typeof BattleStreams.getPlayerStreams>;
export type BranchEngineModule = typeof import('../../lib/lazy/branch-engine');
export type LiveBattle = NonNullable<BattleStream['battle']>;

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
