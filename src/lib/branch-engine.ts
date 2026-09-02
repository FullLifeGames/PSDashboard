import type { TurnSnapshot } from '../types';
import type { BranchRuntime, SimBattle } from './branch/types';
import { correctBattleFromSnapshot, hasStaleForcedSwitchRequest, refreshRequestsFromLiveState } from './branch/corrections';

export type {
  BranchChoiceErrorLog, BranchExecuteResult, BranchFieldState, BranchMoveOption, BranchRuntime, BranchSimState,
  BranchSlotModifiers, BranchSwitchOption, BranchTargetOption, PokemonStatTable, SimPokemonInfo,
} from './branch/types';
export { correctActivesFromProtocol } from './branch/corrections';
export {
  captureSerializedPosition, createBranchState, createBranchStateFromBattle, serializePreviewPosition,
} from './branch/state';
export { annotateNicknames, executeBranchChoices, resolveSideChoices } from './branch/execute';
export type { ResolvedSideCommand } from './branch/execute';
export { reconstructBranchRuntime } from './branch/runtime';
export type { ReconstructParams } from './branch/runtime';

// @pkmn/sim's random-format rulesets reference Node's `global` object (e.g.
// `global.Config?.potd` in rulesets), which doesn't exist in browsers and made
// every Random Battle branch die with an uncaught ReferenceError (B2).
if (typeof (globalThis as Record<string, unknown>).global === 'undefined') {
  (globalThis as Record<string, unknown>).global = globalThis;
}

/**
 * The end-of-reconstruction correction chain a per-target run applies to
 * its final battle — for a caller-owned battle (the clone-and-correct
 * single-pass path, see onRawBoundary). Mirrors the tail of
 * reconstructBranchRuntime exactly: snapshot correction when a snapshot
 * exists, then the request refresh, in that order.
 */
export function applyTargetCorrections(battle: SimBattle, snapshot: TurnSnapshot | null | undefined): void {
  if (snapshot) correctBattleFromSnapshot(battle, snapshot);
  refreshRequestsFromLiveState(battle);
}

/**
 * Post-reconstruction sanity check (B7): detects wedged states — no pending
 * request on a live battle, or a forced switch that has no eligible switch-in —
 * so the UI can offer a way out instead of silently dead-ending.
 */
/**
 * Did this reconstruction actually ARRIVE at `turn` as a live position?
 * `validateBranchRuntime` deliberately accepts an ended battle (branching
 * into a finished line is a legal, explained state), so callers that use
 * the final battle AS a specific turn's position need this stricter test:
 *
 * - short of the turn  → the replay wedged on the way there;
 * - `ended`            → always an artifact for a sampled turn, because a
 *   sampled turn lies BEFORE the real game's end; an ended arrival means
 *   the diverging choice replay killed a side the real game kept (the
 *   premature-end cascade, gen9draft-2058494320 from turn 56 unhealed).
 *   The calibration harness applies the same invariant when scoring.
 *
 * Without it the eval sweep stored a prematurely-ended battle as the LAST
 * turn's position, and the graph showed a single phantom ±1.00 point at
 * the far right with every other turn a gap (2026-08-12 report).
 */
export function reconstructionReached(runtime: BranchRuntime, turn: number): boolean {
  if (runtime.timedOut) return false;
  const battle = runtime.battleStream.battle;
  if (!battle || battle.ended) return false;
  return battle.turn >= turn;
}

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

