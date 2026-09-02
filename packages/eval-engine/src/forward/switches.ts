import { PRNG } from '@pkmn/sim';
import type { Battle, PRNGSeed, Side } from '@pkmn/sim';
import { evaluatePosition } from '../eval-function';
import type { SimPosition } from './position';
import { sideIndex } from '@fulllifegames/replay-core';
import { deserializeRepaired, serializeBattleStable } from './serialize';

/**
 * Choice submission and forced-switch resolution: applying a choice to a
 * forked battle, repairing fainted actives after snapshot corrections, and
 * the greedy mid-turn replacement pick.
 */

const REPAIR_SEED: PRNGSeed = '1,2,3,4';

/**
 * Snapshot corrections can faint an active without updating the request
 * (rare diverged reconstructions). The sim then auto-passes the dead slot
 * and rejects every choice with "more choices than unfainted Pokémon".
 * Repair: flag the corpse for replacement, regenerate a proper switch
 * request, and greedily resolve it to a clean turn boundary. Deterministic,
 * so every fork of the same serialized string repairs identically.
 */
export function repairFaintedActives(battle: Battle): void {
  if (battle.ended) return;
  const stale = battle.sides
    .slice(0, 2)
    .filter(side => side.requestState === 'move' &&
      side.active.some(active => active?.fainted) &&
      // Without a living bench there is nothing to send in — the sim
      // auto-passes the dead slot, so a switch request would only wedge.
      side.pokemon.some(pokemon => !pokemon.isActive && !pokemon.fainted));
  if (stale.length === 0) return;
  for (const side of stale) {
    for (const active of side.active) {
      if (active?.fainted) active.switchFlag = true;
    }
  }
  battle.makeRequest('switch');
  resolveForcedSwitches(battle, REPAIR_SEED);
}

/**
 * Deserializes a fresh copy of the position and seeds its PRNG so the
 * advance is reproducible.
 */
export function forkBattle(position: SimPosition, seed: PRNGSeed): Battle {
  const battle = deserializeRepaired(position.serialized);
  battle.prng = new PRNG(seed);
  repairFaintedActives(battle);
  return battle;
}

export function applyChoice(battle: Battle, side: 'p1' | 'p2', choice: string): void {
  // The waiting-side sentinel (see legalChoices): nothing to submit.
  if (choice === 'wait') return;
  // Pivot pairs carry their follow-up after ' > ' — the move submits now,
  // the follow-up answers the forced-switch request in resolveForcedSwitches.
  [choice] = choice.split(' > ');
  if (!battle.choose(side, choice)) {
    const error = battle.sides[sideIndex(side)].choice.error || 'choice rejected';
    throw new Error(`${side} "${choice}": ${error}`);
  }
}

/**
 * Resolves any open forced-switch requests (mid-turn KOs) by greedily
 * picking the replacement whose entry statically evaluates best for the
 * choosing side. Runs until the battle is back at a turn boundary or over.
 */
/**
 * All ways to assign distinct bench replacements to the forced slots, as
 * ready-to-send choice strings. With fewer replacements than forced slots
 * the remainder passes.
 */
function switchAssignments(forcedCount: number, benchSlots: number[]): string[] {
  if (forcedCount <= 1) return benchSlots.map(slot => `switch ${slot}`);
  const assignments: string[] = [];
  if (benchSlots.length === 1) {
    return [`switch ${benchSlots[0]}, pass`, `pass, switch ${benchSlots[0]}`];
  }
  for (const first of benchSlots) {
    for (const second of benchSlots) {
      if (first === second) continue;
      assignments.push(`switch ${first}, switch ${second}`);
    }
  }
  return assignments;
}

/**
 * A pivot pair's declared follow-up answers this side's first switch
 * request. Consumed once; true when the sim accepted it, false after a
 * reject (target dragged/fainted mid-turn), which falls back to the greedy
 * resolution.
 */
function answerFollowUp(
  battle: Battle,
  side: Side,
  forcedCount: number,
  followUps: { p1?: string; p2?: string },
): boolean {
  const followUp = followUps[side.id as 'p1' | 'p2'];
  if (!(followUp && forcedCount === 1)) return false;
  delete followUps[side.id as 'p1' | 'p2'];
  if (battle.choose(side.id as 'p1' | 'p2', followUp)) return true;
  side.clearChoice();
  return false;
}

/** The assignment whose entry statically evaluates best for the choosing side (the first one when alone). */
function bestAssignment(side: Side, midTurn: string, seed: PRNGSeed, assignments: string[]): string {
  let best = assignments[0];
  if (assignments.length > 1) {
    const perspective = side.id === 'p1' ? 1 : -1;
    let bestValue = -Infinity;
    for (const candidate of assignments) {
      const trial = deserializeRepaired(midTurn);
      trial.prng = new PRNG(seed);
      if (!trial.choose(side.id as 'p1' | 'p2', candidate)) continue;
      const value = perspective * evaluatePosition(trial);
      if (value > bestValue) {
        bestValue = value;
        best = candidate;
      }
    }
  }
  return best;
}

/**
 * Resolves any open forced-switch requests (mid-turn KOs) by greedily
 * picking the replacement whose entry statically evaluates best for the
 * choosing side. Runs until the battle is back at a turn boundary or over.
 */
export function resolveForcedSwitches(
  battle: Battle,
  seed: PRNGSeed,
  followUps: { p1?: string; p2?: string } = {},
): void {
  for (let guard = 0; guard < 6; guard++) {
    if (battle.ended) return;
    const pending = battle.sides
      .slice(0, 2)
      .filter(side => side.requestState === 'switch' && !side.isChoiceDone());
    if (pending.length === 0) return;

    const midTurn = serializeBattleStable(battle);
    for (const side of pending) {
      const request = side.activeRequest as { forceSwitch?: boolean[] } | null;
      const forcedCount = Math.max(1, (request?.forceSwitch ?? []).filter(Boolean).length);
      if (answerFollowUp(battle, side, forcedCount, followUps)) continue;
      const benchSlots = side.pokemon
        .map((pokemon, index) => ({ pokemon, slot: index + 1 }))
        .filter(({ pokemon }) => !pokemon.isActive && !pokemon.fainted)
        .map(({ slot }) => slot);
      if (benchSlots.length === 0) continue;

      const best = bestAssignment(side, midTurn, seed, switchAssignments(forcedCount, benchSlots));
      applyChoice(battle, side.id as 'p1' | 'p2', best);
    }
  }
}
