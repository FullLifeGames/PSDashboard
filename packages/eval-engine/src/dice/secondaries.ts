import type { Battle } from '@pkmn/sim';
import { secondaryDiceOf } from './offer.ts';
import { secondaryEffectId } from './recognize.ts';
import type { SecondaryEntry } from './types.ts';

/** The effect ids (`secondaryEffectId`) of the entries of a move's secondaries with a chance below 100, from the Dex of the game's own rule set (`battle.dex` or `rulesDex`). */
export function secondariesIn(dex: { moves: { get(id: string): unknown } }): (moveId: string) => string[] {
  return moveId => {
    const move = dex.moves.get(moveId) as { secondaries?: SecondaryEntry[] | null; secondary?: SecondaryEntry | null };
    const entries = move.secondaries ?? (move.secondary ? [move.secondary] : []);
    return entries.filter(entry => entry.chance !== undefined && entry.chance < 100).map(entry => secondaryEffectId(entry));
  };
}

export interface SecondaryChance {
  /** The effect id of the entry (`secondaryEffectId`: a status, a volatile status, `boosts:<stats>`, `self:...`). */
  effectId: string;
  /** The chance of the entry's die, 0 to 1 (exclusive of 1). */
  chance: number;
}

const reads = new WeakMap<Battle, Map<string, SecondaryChance[]>>();

/**
 * The secondary entries a move of `userSlot` draws against `targetSlot` with a chance under 1, after the move's and the user's `ModifyMove` and the
 * target's `ModifySecondaries` (Serene Grace, Sheer Force, Shield Dust, Covert Cloak, a King's Rock flinch): read from the simulator on a copy and
 * cached per battle object, turn, user, move and target.
 */
export function secondaryChances(battle: Battle, userSlot: string, moveId: string, targetSlot: string): SecondaryChance[] {
  let cache = reads.get(battle);
  if (!cache) reads.set(battle, (cache = new Map()));
  const key = `${battle.turn}|${userSlot}|${moveId}|${targetSlot}`;
  let found = cache.get(key);
  if (!found) cache.set(key, (found = secondaryDiceOf(battle, userSlot, moveId, targetSlot).filter(entry => entry.chance < 1)));
  return found;
}
