import type { Battle, PRNGSeed, Side } from '@pkmn/sim';
import { forkBattle, toPosition, type SimPosition } from './position.ts';
import type { RollScripts } from './scripted-prng.ts';
import { answerFollowUps, applyChoice, resolveForcedSwitches } from './switches.ts';
import { sideIndex, toId } from '@fulllifegames/replay-core';

// One-turn advances under a fixed seed: the search's advance (greedy forced switches) and the hax-alignment trial.

/** Advances one full turn under a fixed seed, to a turn boundary or the game end; the input position is never mutated. */
export function advancePosition(
  position: SimPosition,
  p1Choice: string,
  p2Choice: string,
  seed: PRNGSeed,
): SimPosition {
  return advancePositionWithLog(position, p1Choice, p2Choice, seed).child;
}

export interface AdvanceOptions {
  /**
   * Stops at the first forced-switch request no pivot follow-up answers, so the tree can search the replacement as a decision node.
   * Default: resolve greedily.
   */
  stopAtForcedSwitch?: boolean;
  /** Dice on demand for the named moves (scripted-prng.ts); the log still decides the outcome class. */
  scripts?: RollScripts;
}

/**
 * advancePosition plus the battle.log delta of this advance only. With `stopAtForcedSwitch` the child may sit at an open switch
 * request (`pendingSwitch`), and its log ends there.
 */
export function advancePositionWithLog(
  position: SimPosition,
  p1Choice: string,
  p2Choice: string,
  seed: PRNGSeed,
  opts?: AdvanceOptions,
): { child: SimPosition; log: string[]; pendingSwitch: boolean } {
  const battle = forkBattle(position, seed, opts?.scripts);
  const logStart = battle.log.length;
  applyChoice(battle, 'p1', p1Choice);
  applyChoice(battle, 'p2', p2Choice);
  const followUps = { p1: p1Choice.split(' > ')[1], p2: p2Choice.split(' > ')[1] };
  let pendingSwitch = false;
  if (opts?.stopAtForcedSwitch) {
    const stand = answerFollowUps(battle, followUps);
    if (stand === 'pending') pendingSwitch = true;
    else if (stand === 'mixed') resolveForcedSwitches(battle, seed, followUps);
  } else {
    resolveForcedSwitches(battle, seed, followUps);
  }
  return { child: toPosition(battle), log: battle.log.slice(logStart), pendingSwitch };
}

export interface TrialAdvanceResult {
  /** The battle.log delta of this advance only. */
  log: string[];
  ended: boolean;
  winner: string | null;
}

/** The 1-based bench slot of the species or name, or null. */
function benchSlotForSpecies(battle: Battle, sideIdx: 0 | 1, species: string): number | null {
  const wanted = toId(species);
  if (wanted === '') return null;
  const side = battle.sides[sideIdx];
  for (let index = 0; index < side.pokemon.length; index++) {
    const pokemon = side.pokemon[index];
    if (pokemon.isActive || pokemon.fainted) continue;
    if (toId(pokemon.species?.name || '') === wanted || toId(pokemon.name || '') === wanted) {
      return index + 1;
    }
  }
  return null;
}

/** Answers one side's forced-switch request from the protocol queue: true when the sim accepted the switch. */
function answerFromQueue(battle: Battle, side: Side, queues: { p1: string[]; p2: string[] }): boolean {
  const sideId = side.id as 'p1' | 'p2';
  const request = side.activeRequest as { forceSwitch?: boolean[] } | null;
  const needs = request?.forceSwitch ?? [true];
  const forcedCount = needs.filter(Boolean).length;
  if (!(forcedCount === 1 && queues[sideId].length > 0)) return false;
  const species = queues[sideId].shift()!;
  const slot = benchSlotForSpecies(battle, sideIndex(sideId), species);
  if (slot === null) return false;
  const fragments = needs.map(need => (need ? `switch ${slot}` : 'pass'));
  if (battle.choose(sideId, fragments.join(', '))) return true;
  side.clearChoice();
  return false;
}

/**
 * Like advancePosition, but returns the emitted log and answers forced-switch requests from the protocol's replacement species
 * (queues per side, in logged order; singles-exact: a multi-slot doubles request or an untranslatable species falls back to the
 * greedy resolution). Throws on a rejected choice.
 */
export function trialAdvanceLog(
  position: SimPosition,
  p1Choice: string,
  p2Choice: string,
  seed: PRNGSeed,
  forcedSpecies?: { p1: string[]; p2: string[] },
): TrialAdvanceResult {
  const battle = forkBattle(position, seed);
  const logStart = battle.log.length;
  applyChoice(battle, 'p1', p1Choice);
  applyChoice(battle, 'p2', p2Choice);
  const queues = {
    p1: [...(forcedSpecies?.p1 ?? [])],
    p2: [...(forcedSpecies?.p2 ?? [])],
  };
  for (let guard = 0; guard < 6 && !battle.ended; guard++) {
    const pending = battle.sides
      .slice(0, 2)
      .filter(side => side.requestState === 'switch' && !side.isChoiceDone());
    if (pending.length === 0) break;
    let unresolved = false;
    for (const side of pending) {
      if (!answerFromQueue(battle, side, queues)) unresolved = true;
    }
    if (unresolved) {
      // Doubles multi-forced, empty queue, or a rejected translation:
      // greedy resolution finishes every pending request (and any cascades).
      resolveForcedSwitches(battle, seed);
      break;
    }
  }
  resolveForcedSwitches(battle, seed);
  return {
    log: battle.log.slice(logStart),
    ended: battle.ended,
    winner: battle.winner || null,
  };
}
