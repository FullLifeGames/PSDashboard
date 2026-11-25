import type { Battle } from '@pkmn/sim';
import { secondaryDiceOf } from './offer.ts';
import { secondaryEffectId } from './recognize.ts';
import type { SecondaryEntry } from './types.ts';

/** The effect ids of a move's secondary entries with a chance below 100, from the game's own Dex. */
export function secondariesIn(dex: { moves: { get(id: string): unknown } }): (moveId: string) => string[] {
  return moveId => {
    const move = dex.moves.get(moveId) as { secondaries?: SecondaryEntry[] | null; secondary?: SecondaryEntry | null };
    const entries = move.secondaries ?? (move.secondary ? [move.secondary] : []);
    return entries.filter(entry => entry.chance !== undefined && entry.chance < 100).map(entry => secondaryEffectId(entry));
  };
}

export interface SecondaryChance {
  effectId: string;
  /** The chance of the entry's die, 0 to 1 (exclusive). */
  chance: number;
}

const reads = new WeakMap<Battle, Map<string, SecondaryChance[]>>();

/** Entries with a chance under 1 after ModifyMove, ModifySecondaries; cached per battle, turn, user, move, target. */
export function secondaryChances(battle: Battle, userSlot: string, moveId: string, targetSlot: string): SecondaryChance[] {
  let cache = reads.get(battle);
  if (!cache) reads.set(battle, (cache = new Map()));
  const key = `${battle.turn}|${userSlot}|${moveId}|${targetSlot}`;
  let found = cache.get(key);
  if (!found) cache.set(key, (found = secondaryDiceOf(battle, userSlot, moveId, targetSlot).filter(entry => entry.chance < 1)));
  return found;
}
