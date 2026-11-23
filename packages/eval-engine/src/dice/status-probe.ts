import type { Battle, Pokemon } from '@pkmn/sim';
import { FixedDice, copyOf } from '../sim-ask/copy.ts';

/**
 * What a status check draws and which way it goes: the condition's own `BeforeMove` handler is the check, and its polarity differs by handler (full
 * paralysis stops the body when the chance comes true, the thaw frees it, the confusion check lets it go on up to Gen 6 and hits it from Gen 7 on).
 * The module reads the polarity by calling the Dex entry of the die's `effectId` alone on a copy, with the question module's `FixedDice` answering
 * every chance "yes", and asking whether the handler stopped the move (a return of `false`); the battle it reads stays untouched.
 */

export interface CheckProbe {
  /** The chance of the check's first draw, numerator over denominator. */
  chance: number;
  /** Whether the body goes on with its move when the draw comes true. */
  actsOnTrue: boolean;
}

type Handler = (this: Battle, ...args: unknown[]) => unknown;
interface ConditionLike { effectType?: string; onBeforeMove?: Handler }

const bodyAt = (battle: Battle, slot: string): Pokemon | undefined => battle.sides[slot[1] === '1' ? 0 : 1].active[slot[2] === 'a' ? 0 : 1];

/** The state the condition keeps on the body, adding the condition to the copy when the body lacks it (a check that starts in the turn). */
function stateOf(body: Pokemon, id: string, condition: ConditionLike, foe: Pokemon | undefined): unknown {
  if (condition.effectType === 'Status') {
    if (body.status !== id) body.setStatus(id);
    return body.status === id ? body.statusState : null;
  }
  if (!body.volatiles[id]) body.addVolatile(id, foe);
  return body.volatiles[id] ?? null;
}

/**
 * The first chance the condition's `BeforeMove` handler draws for `slot` using `moveId`, and whether the body acts when that
 * chance comes true; null when the Dex entry has no such handler or the handler draws no chance (a move that thaws its user,
 * a freeze whose timer ran out, a condition the body cannot hold).
 */
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
  // putting the condition on the copy may have drawn; only the handler's own draw counts
  dice.clearChance();
  const move = copy.dex.getActiveMove(moveId);
  (copy as unknown as { setActiveMove(move: unknown, pokemon: Pokemon, target?: Pokemon): void }).setActiveMove(move, body, foe);
  const events = copy as unknown as { singleEvent(...args: unknown[]): unknown };
  const result = events.singleEvent('BeforeMove', condition, state, body, foe, move);
  return dice.firstChance === null ? null : { chance: dice.firstChance, actsOnTrue: result !== false };
}
