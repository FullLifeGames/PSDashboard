import type { Side } from '@pkmn/sim';
import { toId } from '@fulllifegames/replay-core';

/**
 * Request entries as the sim writes them (side.activeRequest.active[n].moves).
 * A locked move (rampage, charge release, recharge, Bide, Uproar) comes with
 * no `target` key at all (pokemon.js getMoves(lockedMove)).
 */
export interface RequestMove {
  move: string;
  id?: string;
  disabled?: unknown;
  target?: unknown;
}

interface RequestSlot {
  moves: RequestMove[];
}

/** The move id the sim accepts: the entry's id when present, else the display name's key. */
export function requestMoveKey(move: RequestMove): string {
  // Happiness moves display with computed BP ("Return 102"): the entry's id
  // is the token the sim accepts, the display name is only the label.
  return move.id || toId(move.move);
}

/** A locked entry: the sim keeps the target itself (side.js:480-492, lastMoveTargetLoc). */
export function isLockedEntry(move: RequestMove): boolean {
  return !('target' in move);
}

/** The first slot at or after `from` the sim asks a choice for (side.js getChoiceIndex: fainted and commanding actives pass). */
function nextChoosingSlot(sideState: Side, from: number): number {
  let slot = from;
  while (slot < sideState.active.length) {
    const active = sideState.active[slot];
    if (!active || (!active.fainted && !active.volatiles['commanding'])) return slot;
    slot++;
  }
  return slot;
}

/** One part of a doubles choice in the form the sim accepts for the slot's request entries. */
function submittablePart(part: string, entries: RequestMove[]): string {
  const tokens = part.split(' ');
  if (tokens[0] !== 'move') return part;
  const index = entries.findIndex(entry => requestMoveKey(entry) === tokens[1]);
  if (index < 0 || !isLockedEntry(entries[index])) return part;
  return ['move', String(index + 1), ...tokens.slice(2).filter(token => !/^[+-]?\d+$/.test(token))].join(' ');
}

/**
 * A doubles choice the sim accepts. By name a locked move makes the sim assume
 * target type 'normal' and demand a target (side.js:397,469); by its entry
 * index the sim takes the missing type as is and then uses the locked target
 * (side.js:384,480-492). Locked parts therefore go by index, without a target
 * number. Singles and every choice without a locked part come back as the
 * same string.
 */
export function submittableChoice(sideState: Side, choice: string): string {
  if (sideState.active.length < 2 || sideState.requestState !== 'move') return choice;
  const slots = (sideState.activeRequest as { active?: (RequestSlot | null)[] } | null)?.active;
  if (!slots) return choice;
  let slot = 0;
  const parts = choice.split(',').map(raw => {
    slot = nextChoosingSlot(sideState, slot);
    const part = submittablePart(raw.trim(), slots[slot]?.moves ?? []);
    slot++;
    return part;
  });
  const rebuilt = parts.join(', ');
  return rebuilt === choice.split(',').map(raw => raw.trim()).join(', ') ? choice : rebuilt;
}
