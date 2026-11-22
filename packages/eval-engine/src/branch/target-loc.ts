import { sideIndex, toId, type RulesDex } from '@fulllifegames/replay-core';
import type { SimBattle, SimPokemon } from './types.ts';
import { formatTargetLoc, slotLetter } from './team-order.ts';
import { aimThatFailsAsLogged, hidesItsTarget } from '../sim-ask/index.ts';

/**
 * The aim of a click: the loc the log's target maps to, the suffix a doubles click carries, and (round 89, #136) the aim of a move line
 * whose target the protocol hides. Split out of `protocol-choices.ts`, which re-exports the two names its callers import.
 */

export function protocolTargetLoc(
  battle: SimBattle,
  sourceSide: 'p1' | 'p2',
  sourceActiveSlot: number,
  targetIdent: string | undefined,
): number {
  const match = targetIdent?.match(/^(p[12])([a-d]):/);
  if (!match) return 0;

  const sourceSideIdx = sideIndex(sourceSide);
  const targetSideIdx = match[1] === 'p1' ? 0 : 1;
  const targetActiveSlot = match[2].charCodeAt(0) - 'a'.charCodeAt(0);
  const source = battle.sides[sourceSideIdx].active[sourceActiveSlot];
  const target = battle.sides[targetSideIdx].active[targetActiveSlot];

  if (source && target) return source.getLocOf(target);
  return targetSideIdx === sourceSideIdx ? -(targetActiveSlot + 1) : targetActiveSlot + 1;
}

export function targetTypeForMove(dex: RulesDex, active: SimPokemon | null | undefined, moveName: string): string {
  if (!active) return dex.moves.get(moveName).target || '';
  const moveId = toId(moveName);
  const request = active.getMoveRequestData();
  return request.moves.find(move => move.id === moveId)?.target || dex.moves.get(moveName).target || '';
}

function shouldAppendTargetLoc(
  battle: SimBattle,
  active: SimPokemon | null | undefined,
  moveName: string,
  targetLoc: number,
): boolean {
  if (!active || !targetLoc || active.side.active.length < 2) return false;
  const targetType = targetTypeForMove(battle.dex, active, moveName);
  return battle.actions.targetTypeChoices(targetType) && battle.validTargetLoc(targetLoc, active, targetType);
}

/**
 * A locked request (recharge, the release turn of Fly or Dig, a continued
 * rampage) carries one entry WITHOUT a `target`, and the sim rejects any loc
 * on it together with the whole side choice. The Dex fallback in
 * `targetTypeForMove` would still name a target type there.
 */
function requestEntryHasNoTarget(active: SimPokemon | null | undefined, moveName: string): boolean {
  if (!active) return false;
  const moveId = toId(moveName);
  const entry = active.getMoveRequestData().moves.find(move => move.id === moveId);
  return !!entry && !entry.target;
}

export function targetLocSuffixForChoice(
  battle: SimBattle,
  active: SimPokemon | null | undefined,
  moveName: string,
  protocolTargetLoc: number,
): string {
  if (requestEntryHasNoTarget(active, moveName)) return '';
  if (shouldAppendTargetLoc(battle, active, moveName, protocolTargetLoc)) {
    return ` ${formatTargetLoc(protocolTargetLoc)}`;
  }

  if (!active || active.side.active.length < 2) return '';
  const targetType = targetTypeForMove(battle.dex, active, moveName);
  if (!battle.actions.targetTypeChoices(targetType)) return '';

  const fallbackTargetLoc = firstLegalTargetLoc(battle, active, targetType);
  return fallbackTargetLoc ? ` ${formatTargetLoc(fallbackTargetLoc)}` : '';
}

/** The aims a click may name for this target type, in the default order: the foe in slot a, the ally in slot a, the foe in slot b, the ally in slot b. */
export function legalTargetLocs(battle: SimBattle, active: SimPokemon, targetType: string): number[] {
  if (active.side.active.length < 2 || !battle.actions.targetTypeChoices(targetType)) return [];
  const locs: number[] = [];
  for (let loc = 1; loc <= battle.activePerHalf; loc++) {
    for (const targetLoc of [loc, -loc]) {
      if (battle.validTargetLoc(targetLoc, active, targetType)) locs.push(targetLoc);
    }
  }
  return locs;
}

export function firstLegalTargetLoc(battle: SimBattle, active: SimPokemon, targetType: string): number | null {
  return legalTargetLocs(battle, active, targetType)[0] ?? null;
}

/**
 * Round 89 (#136): the aims of the turn's choices. `resolved` holds the aim a slot's hidden target was answered with (key side and
 * slot: `p2b`); `ask` is false while a question to the simulator builds the turn's choices for one aim.
 */
export interface Aiming { ask: boolean; resolved: Map<string, number> }

/** The choice of one slot of `owner` with these answered aims and no further question: the caller's own `getChoiceForSlot`. */
export type SlotChoice = (owner: 'p1' | 'p2', slot: number, aiming: Aiming) => string;

/**
 * Round 89 (#136): the aim of a move line that hides its target (`|move|p2b: Sableye|Disable||[still]`: the game stopped the move before it
 * animated). The default aim falls on the foe in slot a, and a Disable or Encore that failed on a fresh switch-in in slot b landed there. The
 * question goes to the simulator (`aimThatFailsAsLogged`): the turn's choices with each legal aim, played on a copy; the first aim that fails
 * as the log shows wins, else the default stays (0). Doubles only: with one foe the move has one aim. The other bodies' hidden aims stay at
 * their default while a slot is asked; the slots of the side are answered in order, so a later slot reads the earlier answers.
 */
export function hiddenTargetLoc(
  line: string, side: 'p1' | 'p2', activeSlot: number, battle: SimBattle, moveName: string, aiming: Aiming, choiceOf: SlotChoice,
): number {
  if (!aiming.ask || !hidesItsTarget(line)) return 0;
  const active = battle.sides[sideIndex(side)].active[activeSlot];
  if (!active || requestEntryHasNoTarget(active, moveName)) return 0;
  const aims = legalTargetLocs(battle, active, targetTypeForMove(battle.dex, active, moveName));
  if (aims.length < 2) return 0;
  const key = `${side}${slotLetter(activeSlot)}`;
  const answer = aimThatFailsAsLogged(battle, {
    ident: `${key}:`,
    moveId: toId(moveName),
    aims,
    choicesFor: aim => {
      const resolved = new Map([...aiming.resolved, [key, aim]]);
      const turn = (owner: 'p1' | 'p2') => battle.sides[sideIndex(owner)].active
        .map((_, slot) => choiceOf(owner, slot, { ask: false, resolved })).join(', ');
      return { p1: turn('p1'), p2: turn('p2') };
    },
  });
  if (answer !== null) aiming.resolved.set(key, answer);
  return answer ?? 0;
}
