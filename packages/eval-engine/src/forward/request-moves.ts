import type { Side } from '@pkmn/sim';
import { toId } from '@fulllifegames/replay-core';

/** A request entry (side.activeRequest.active[n].moves); a locked move has no `target` key (pokemon.js getMoves). */
export interface RequestMove {
  move: string;
  id?: string;
  disabled?: unknown;
  target?: unknown;
}

interface RequestSlot {
  moves: RequestMove[];
}

export function requestMoveKey(move: RequestMove): string {
  // Happiness moves display with computed BP ("Return 102"): the entry's id is what the sim accepts, not the label.
  return move.id || toId(move.move);
}

/** A locked entry: the sim keeps the target itself (side.js:480-492, lastMoveTargetLoc). */
export function isLockedEntry(move: RequestMove): boolean {
  return !('target' in move);
}

/** A Tatsugiri inside its Dondozo (`commanding` volatile): the simulator passes its slot (side.js getChoiceIndex). */
export function isCommanding(pokemon: { volatiles: Record<string, unknown> }): boolean {
  return !!pokemon.volatiles['commanding'];
}

export function nextChoosingSlot(sideState: Side, from: number): number {
  let slot = from;
  while (slot < sideState.active.length) {
    const active = sideState.active[slot];
    if (!active || (!active.fainted && !isCommanding(active))) return slot;
    slot++;
  }
  return slot;
}

function submittablePart(part: string, entries: RequestMove[]): string {
  const tokens = part.split(' ');
  if (tokens[0] !== 'move') return part;
  const index = entries.findIndex(entry => requestMoveKey(entry) === tokens[1]);
  if (index < 0 || !isLockedEntry(entries[index])) return part;
  return ['move', String(index + 1), ...tokens.slice(2).filter(token => !/^[+-]?\d+$/.test(token))].join(' ');
}

/** A doubles choice the sim accepts: locked parts go by entry index, without a target number. */
// By name the sim demands a target for a locked move (side.js:397,469); by index it uses the locked one (side.js:384).
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
