import type { Battle, Pokemon } from '@pkmn/sim';
import { FixedDice, copyOf } from '../sim-ask/copy.ts';

/** What a status check draws and which way it goes, read from the condition's `BeforeMove` handler on a copy. */

export interface CheckProbe {
  /** The chance of the check's first draw, numerator over denominator. */
  chance: number;
  actsOnTrue: boolean;
}

type Handler = (this: Battle, ...args: unknown[]) => unknown;
interface ConditionLike { effectType?: string; onBeforeMove?: Handler }

const bodyAt = (battle: Battle, slot: string): Pokemon | undefined => battle.sides[slot[1] === '1' ? 0 : 1].active[slot[2] === 'a' ? 0 : 1];

function stateOf(body: Pokemon, id: string, condition: ConditionLike, foe: Pokemon | undefined): unknown {
  if (condition.effectType === 'Status') {
    if (body.status !== id) body.setStatus(id);
    return body.status === id ? body.statusState : null;
  }
  if (!body.volatiles[id]) body.addVolatile(id, foe);
  return body.volatiles[id] ?? null;
}

/** The first chance the `BeforeMove` handler draws and whether the body acts when it comes true; null if none. */
export function probeCheck(battle: Battle, slot: string, effectId: string, moveId: string): CheckProbe | null {
  const copy = copyOf(battle);
  const body = bodyAt(copy, slot);
  const condition = copy.dex.conditions.get(effectId) as unknown as ConditionLike;
  if (!body || body.fainted || typeof condition.onBeforeMove !== 'function') return null;
  const foe = body.foes()[0];
  const dice = new FixedDice({ quantile: 0, chance: true });
  copy.prng = dice;
  const state = stateOf(body, effectId, condition, foe);
  if (!state) return null;
  // Putting the condition on the copy may have drawn; only the handler's own draw counts.
  dice.clearChance();
  const move = copy.dex.getActiveMove(moveId);
  (copy as unknown as { setActiveMove(move: unknown, pokemon: Pokemon, target?: Pokemon): void }).setActiveMove(move, body, foe);
  const events = copy as unknown as { singleEvent(...args: unknown[]): unknown };
  const result = events.singleEvent('BeforeMove', condition, state, body, foe, move);
  return dice.firstChance === null ? null : { chance: dice.firstChance, actsOnTrue: result !== false };
}
