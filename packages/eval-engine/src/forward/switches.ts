import { PRNG } from '@pkmn/sim';
import type { Battle, PRNGSeed, Side } from '@pkmn/sim';
import { createMatchupCache, evaluatePosition } from '../eval-function.ts';
import type { StaticRuleset } from '../score/weights.ts';
import { battleRuleset } from './ruleset.ts';
import { sideIndex } from '@fulllifegames/replay-core';
import { assignmentLabel, switchAssignments } from './assignments.ts';
import { submittableChoice } from './request-moves.ts';
import { isReviving } from './request-reviving.ts';
import { deserializeFromParsed, parseSearchState, type ParsedSearchState } from './parsed-state.ts';
import { restoreSideInvariants, serializeBattleStable } from './serialize.ts';
import { adoptTemplate, copyBattle, prepareBattle, simFastOn } from './sim-fast/index.ts';


const REPAIR_SEED: PRNGSeed = '1,2,3,4';

/** Repairs an active that a snapshot correction fainted without updating the request (the sim rejects every choice). */
export function repairFaintedActives(battle: Battle): void {
  if (battle.ended) return;
  const stale = battle.sides
    .slice(0, 2)
    .filter(side => side.requestState === 'move' &&
      side.active.some(active => active?.fainted) &&
      // No living bench: the sim auto-passes the dead slot, so a switch request would only wedge.
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

/** A `reviving` request (Revival Blessing) takes only a fainted member; other forced switches the living bench. */
export function switchInSlots(side: Side): number[] {
  const reviving = isReviving(side);
  return side.pokemon.flatMap((pokemon, index) => (!pokemon.isActive && pokemon.fainted === reviving ? [index + 1] : []));
}

/** Submits a choice string to a side; throws when the sim rejects it. */
export function applyChoice(battle: Battle, side: 'p1' | 'p2', choice: string): void {
  if (choice === 'wait') return;
  // The follow-up after ' > ' answers the forced-switch request in resolveForcedSwitches.
  [choice] = choice.split(' > ');
  const sideState = battle.sides[sideIndex(side)];
  if (!battle.choose(side, submittableChoice(sideState, choice))) {
    const error = sideState.choice.error || 'choice rejected';
    throw new Error(`${side} "${choice}": ${error}`);
  }
}

function forcedSlotCount(side: Side): number {
  const request = side.activeRequest as { forceSwitch?: boolean[] } | null;
  return Math.max(1, (request?.forceSwitch ?? []).filter(Boolean).length);
}

function pendingSwitchSides(battle: Battle): Side[] {
  return battle.sides
    .slice(0, 2)
    .filter(side => side.requestState === 'switch' && !side.isChoiceDone());
}

// Consumed once; false after a reject (target dragged or fainted mid-turn): the greedy resolution takes over.
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

/** 'boundary', 'pending' (an open request the caller makes a node) or 'mixed' (nothing submitted: resolve greedily). */
export function answerFollowUps(
  battle: Battle,
  followUps: { p1?: string; p2?: string },
): 'boundary' | 'pending' | 'mixed' {
  for (let guard = 0; guard < 6; guard++) {
    if (battle.ended) return 'boundary';
    const pending = pendingSwitchSides(battle);
    if (pending.length === 0) return 'boundary';
    const answerable = pending.filter(side =>
      !!followUps[side.id as 'p1' | 'p2'] && forcedSlotCount(side) === 1);
    if (answerable.length === 0) return 'pending';
    if (answerable.length < pending.length) return 'mixed';
    for (const side of pending) {
      if (!answerFollowUp(battle, side, 1, followUps)) return 'pending';
    }
  }
  return 'pending';
}

function bestAssignment(side: Side, midTurn: () => Battle, seed: PRNGSeed, assignments: string[], ruleset: StaticRuleset): string {
  let best = assignments[0];
  if (assignments.length > 1) {
    const perspective = side.id === 'p1' ? 1 : -1;
    let bestValue = -Infinity;
    for (const candidate of assignments) {
      const trial = midTurn();
      trial.prng = new PRNG(seed);
      if (!trial.choose(side.id as 'p1' | 'p2', candidate)) continue;
      const value = perspective * evaluatePosition(trial, createMatchupCache(ruleset));
      if (value > bestValue) {
        bestValue = value;
        best = candidate;
      }
    }
  }
  return best;
}

function midTurnSource(battle: Battle): () => Battle {
  const snapshot = simFastOn('clone') ? copyBattle(battle) : null;
  if (snapshot) {
    snapshot.prng = new PRNG(battle.prng.getSeed());
    adoptTemplate(snapshot);
    let parsedFallback: ParsedSearchState | null = null;
    return () => {
      const trial = copyBattle(snapshot);
      if (!trial) return deserializeFromParsed(parsedFallback ??= parseSearchState(serializeBattleStable(snapshot)));
      restoreSideInvariants(trial);
      prepareBattle(trial);
      return trial;
    };
  }
  const midTurn = serializeBattleStable(battle);
  let parsedMid: ParsedSearchState | null = null;
  return () => deserializeFromParsed(parsedMid ??= parseSearchState(midTurn));
}

/** The labels each side's static pick sent in during one round of replacements. */
export interface StaticPick { p1?: string; p2?: string }

/** Answers every open switch request by static value and returns the picks, one entry per round of the guard loop. */
export function resolveForcedSwitches(
  battle: Battle,
  seed: PRNGSeed,
  followUps: { p1?: string; p2?: string } = {},
): StaticPick[] {
  const picks: StaticPick[] = [];
  for (let guard = 0; guard < 6; guard++) {
    if (battle.ended) return picks;
    const pending = pendingSwitchSides(battle);
    if (pending.length === 0) return picks;

    const mid = midTurnSource(battle);
    const round: StaticPick = {};
    const answered: StaticPick = {};
    for (const side of pending) {
      const id = side.id as 'p1' | 'p2';
      const forcedCount = forcedSlotCount(side);
      const followUp = followUps[id];
      const followUpLabel = followUp && forcedCount === 1 ? assignmentLabel(side, followUp) : undefined;
      if (answerFollowUp(battle, side, forcedCount, followUps)) {
        answered[id] = followUpLabel;
        continue;
      }
      const benchSlots = switchInSlots(side);
      if (benchSlots.length === 0) continue;

      const best = bestAssignment(side, mid, seed, switchAssignments(forcedCount, benchSlots), battleRuleset(battle));
      round[id] = assignmentLabel(side, best);
      applyChoice(battle, id, best);
    }
    if (round.p1 !== undefined || round.p2 !== undefined) picks.push({ ...answered, ...round });
  }
  return picks;
}
