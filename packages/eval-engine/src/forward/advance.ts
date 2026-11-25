import type { Battle, PRNGSeed, Side } from '@pkmn/sim';
import { forkBattle, toPosition, type SimPosition } from './position.ts';
import type { RollScripts } from './scripted-prng.ts';
import { answerFollowUps, applyChoice, resolveForcedSwitches, type StaticPick } from './switches.ts';
import { sideIndex, toId } from '@fulllifegames/replay-core';


/** Advances one full turn under a fixed seed, to a turn boundary or the game end; never mutates the input position. */
export function advancePosition(
  position: SimPosition,
  p1Choice: string,
  p2Choice: string,
  seed: PRNGSeed,
): SimPosition {
  return advancePositionWithLog(position, p1Choice, p2Choice, seed).child;
}

export interface AdvanceOptions {
  /** Stops at the first forced-switch request no pivot follow-up answers, for the tree to search; default: greedy. */
  stopAtForcedSwitch?: boolean;
  /** Dice on demand for the named moves (scripted-prng.ts); the log still decides the outcome class. */
  scripts?: RollScripts;
}

/** advancePosition plus this advance's log delta; with `stopAtForcedSwitch` the child may sit at an open switch. */
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
  let picks: StaticPick[] = [];
  if (opts?.stopAtForcedSwitch) {
    const stand = answerFollowUps(battle, followUps);
    if (stand === 'pending') pendingSwitch = true;
    else if (stand === 'mixed') picks = resolveForcedSwitches(battle, seed, followUps);
  } else {
    picks = resolveForcedSwitches(battle, seed, followUps);
  }
  return { child: toPosition(battle, picks), log: battle.log.slice(logStart), pendingSwitch };
}

export interface TrialAdvanceResult {
  log: string[];
  ended: boolean;
  winner: string | null;
}

// 1-based bench slot of the species or name, or null.
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

/** advancePosition with forced switches answered from the protocol's replacement queues; throws on a reject. */
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
      // Doubles multi-forced, empty queue or a rejected translation: the greedy resolution finishes every request.
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
