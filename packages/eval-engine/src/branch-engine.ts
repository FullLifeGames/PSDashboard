import type { TurnSnapshot } from '@fulllifegames/replay-core';
import type { BranchRuntime, SimBattle } from './branch/types.ts';
import { correctBattleFromSnapshot, hasStaleForcedSwitchRequest, refreshRequestsFromLiveState } from './branch/corrections.ts';

export type {
  BranchChoiceErrorLog, BranchExecuteResult, BranchFieldState, BranchMoveOption, BranchRuntime, BranchSimState,
  BranchSlotModifiers, BranchSwitchOption, BranchTargetOption, PokemonStatTable, SimPokemonInfo,
} from './branch/types.ts';
export { correctActivesFromProtocol } from './branch/corrections.ts';
export {
  captureSerializedPosition, createBranchState, createBranchStateFromBattle, serializePreviewPosition,
} from './branch/state.ts';
export { annotateNicknames, executeBranchChoices, resolveSideChoices } from './branch/execute.ts';
export type { BranchDiceTurn, ResolvedSideCommand } from './branch/execute.ts';
export { reconstructBranchRuntime } from './branch/runtime.ts';
export type { ReconstructParams, ReplacementPoint } from './branch/runtime.ts';
export { adoptSerializedRuntime } from './branch/adopt.ts';
export type { AdoptParams } from './branch/adopt.ts';

// @pkmn/sim's random-format rulesets read Node's `global` (`global.Config?.potd`), which browsers lack: without it every Random Battle
// branch dies with a ReferenceError.
if (typeof (globalThis as Record<string, unknown>).global === 'undefined') {
  (globalThis as Record<string, unknown>).global = globalThis;
}

/** The end-of-reconstruction correction chain for a caller-owned battle, in the order of the tail of `reconstructBranchRuntime` (snapshot correction, then request refresh). */
export function applyTargetCorrections(battle: SimBattle, snapshot: TurnSnapshot | null | undefined): void {
  if (snapshot) correctBattleFromSnapshot(battle, snapshot);
  refreshRequestsFromLiveState(battle);
}

/** Whether the reconstruction reached `turn` as a live position; an ended battle fails, since a sampled turn lies before the real game's end. */
export function reconstructionReached(runtime: BranchRuntime, turn: number): boolean {
  if (runtime.timedOut) return false;
  const battle = runtime.battleStream.battle;
  if (!battle || battle.ended) return false;
  return battle.turn >= turn;
}

/** An error message when the battle is wedged (timed out, no pending request, a forced switch with no eligible switch-in), else null. */
export function validateBranchRuntime(runtime: BranchRuntime): string | null {
  if (runtime.timedOut) {
    return 'Reconstruction timed out before reaching this turn. Try branching from a nearby turn.';
  }

  const battle = runtime.battleStream.battle;
  if (!battle) return 'The simulator could not start this battle.';
  if (battle.ended) return null;

  if (!battle.requestState) {
    return 'The simulator got stuck while rebuilding this turn. Try branching from a nearby turn.';
  }

  if (hasStaleForcedSwitchRequest(battle)) {
    return 'The simulator demands a switch that no longer matches the battle state: the reconstruction diverged at this turn. Try a nearby turn.';
  }

  for (const side of battle.sides) {
    const needsSwitch = side.activeRequest?.forceSwitch?.some(Boolean);
    if (!needsSwitch) continue;
    const hasBench = side.pokemon.some(pokemon => !pokemon.isActive && !pokemon.fainted);
    if (!hasBench) {
      return `${side.name} must switch but has no healthy Pokémon left to send in: the reconstruction diverged at this turn. Try a nearby turn.`;
    }
  }

  return null;
}

