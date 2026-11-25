import { sideIndex } from '@fulllifegames/replay-core';
import { choiceList } from './choices.ts';
import { positionBattle, type SimPosition } from './position.ts';
import { isLockedEntry, nextChoosingSlot, requestMoveKey, type RequestMove } from './request-moves.ts';
import type { Side } from '@pkmn/sim';

interface RequestEntry { moves: RequestMove[]; canDynamax?: unknown; canZMove?: unknown }

// The search aims at an ally only when the player did; the sim accepts it for a target the player may choose.
function aimsAtAlly(sideState: Side, entry: RequestEntry | undefined, slot: number, part: string | undefined): boolean {
  const [kind, key, loc] = (part ?? '').split(' ');
  const move = kind === 'move' ? entry?.moves.find(candidate => requestMoveKey(candidate) === key) : undefined;
  const user = sideState.active[slot];
  const { battle } = sideState;
  if (!move || isLockedEntry(move) || !user || !battle.actions.targetTypeChoices(move.target as string)) return false;
  return sideState.active.some((ally, index) => ally && String(-index - 1) !== loc && battle.validTargetLoc(-index - 1, user, move.target as string));
}

/** The choices the request leaves each slot of a side, Tera allowed: 0 (passes, waits), 1, or 2 for more. */
export function slotChoiceCounts(position: SimPosition, side: 'p1' | 'p2'): number[] {
  const battle = positionBattle(position);
  const sideState = battle.sides[sideIndex(side)];
  const { options, slots } = choiceList(position, side);
  const entries = (sideState.activeRequest as { active?: RequestEntry[] } | null)?.active ?? [];
  const counts = sideState.active.map(() => 0);
  slots.forEach((slot, part) => {
    const parts = new Set(options.map(option => option.choice.split(',')[part]?.trim()));
    const count = parts.size === 1 && parts.has('pass') ? 0 : Math.min(parts.size, 2);
    const hasUnlistedGimmick = !!entries[slot]?.canDynamax || !!entries[slot]?.canZMove;
    counts[slot] = count === 1 && (hasUnlistedGimmick || aimsAtAlly(sideState, entries[slot], slot, [...parts][0])) ? 2 : count;
  });
  if (!battle.ended) {
    entries.forEach((entry, slot) => {
      const struggles = entry && counts[slot] === 0 && sideState.active[slot] && nextChoosingSlot(sideState, slot) === slot;
      if (struggles) counts[slot] = 1;
    });
  }
  return counts;
}
