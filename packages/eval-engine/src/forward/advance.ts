import type { Battle, PRNGSeed, Side } from '@pkmn/sim';
import { toPosition, type SimPosition } from './position.ts';
import { applyChoice, forkBattle, resolveForcedSwitches } from './switches.ts';
import { sideIndex, toId } from '@fulllifegames/replay-core';

/**
 * One-turn advances under a fixed seed: the search's advance (greedy
 * forced-switch resolution) and the hax-alignment trial that answers
 * forced switches from the protocol's replacement species.
 */

/**
 * Advances one full turn under a fixed seed. The returned position is at a
 * normal turn boundary or game end; the input position is never mutated.
 */
export function advancePosition(
  position: SimPosition,
  p1Choice: string,
  p2Choice: string,
  seed: PRNGSeed,
): SimPosition {
  return advancePositionWithLog(position, p1Choice, p2Choice, seed).child;
}

/**
 * advancePosition plus the battle.log delta of THIS advance only — the
 * cell-blend classifier reads outcome classes from these lines.
 */
export function advancePositionWithLog(
  position: SimPosition,
  p1Choice: string,
  p2Choice: string,
  seed: PRNGSeed,
): { child: SimPosition; log: string[] } {
  const battle = forkBattle(position, seed);
  const logStart = battle.log.length;
  applyChoice(battle, 'p1', p1Choice);
  applyChoice(battle, 'p2', p2Choice);
  resolveForcedSwitches(battle, seed, {
    p1: p1Choice.split(' > ')[1],
    p2: p2Choice.split(' > ')[1],
  });
  return { child: toPosition(battle), log: battle.log.slice(logStart) };
}

export interface TrialAdvanceResult {
  /** Lines emitted by THIS advance only (battle.log delta). */
  log: string[];
  ended: boolean;
  winner: string | null;
}

/** First bench slot matching the species/name id, or null. */
function benchSlotForSpecies(battle: Battle, sideIdx: 0 | 1, species: string): number | null {
  const wanted = toId(species);
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

/**
 * Hax-alignment trial: like advancePosition, but returns the emitted log so
 * the caller can score the seed's rolls against the protocol, and answers
 * forced-switch requests from the PROTOCOL's replacement species instead of
 * the greedy eval pick (queues per side, in logged order — singles-exact;
 * a multi-slot doubles request or an untranslatable species falls back to
 * the greedy resolution). Throws on a rejected choice — the caller treats
 * that trial as failed. Search behavior (advancePosition) is unchanged.
 */
/**
 * Answers one side's forced-switch request from the protocol queue: true
 * when the queued species mapped to a bench slot and the sim accepted the
 * switch; false (queue untouched or cleared choice) otherwise.
 */
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
