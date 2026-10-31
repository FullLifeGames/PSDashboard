import type { Battle, Pokemon } from '@pkmn/sim';
import { copyOf } from '../sim-ask/copy.ts';

/**
 * Round 82 (forced dice), step A3b: whether a body's action speed reads the start-of-turn roll of Gens 2 and 3
 * (`battle.quickClawRoll`). The simulator reads it in `getActionSpeed` for the holder of the one item that uses it. The module
 * names no item: it flips the roll on a copy of the battle and asks the body for its action speed; a body whose speed moves
 * with the roll holds such an item.
 */
export function readsStartRoll(battle: Battle, slot: string): boolean {
  const copy = copyOf(battle);
  const body: Pokemon | undefined = copy.sides[slot[1] === '1' ? 0 : 1].active[slot[2] === 'a' ? 0 : 1];
  if (!body || body.fainted) return false;
  const roll = copy as unknown as { quickClawRoll?: boolean };
  roll.quickClawRoll = false;
  const without = body.getActionSpeed();
  roll.quickClawRoll = true;
  return body.getActionSpeed() !== without;
}
