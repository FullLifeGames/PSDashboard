import type { CalcGeneration } from '@fulllifegames/replay-core';
import { callHandler } from '../sim-ask/index.ts';
import { simDexOf, type CalcBody } from './body.ts';

/**
 * Round 68 (T186, decision 4): does Protect stop this move, as the simulator plays it? The calculator's own Protect
 * check (`isProtected` on the defender's side) is wrong for an ability the simulator handles in the move: calc 0.12
 * prices every Unseen Fist hit into Protect at a quarter, while the simulator deletes the protect flag of a contact
 * move in the ability's ModifyMove (full damage) and keeps it in the Champions mod, where the quarter comes from
 * onHitProtect (the way Piercing Drill plays in every mod). The answer is read from the simulator's own data: the
 * active move, the attacker ability's onModifyMove run through `callHandler` (sim-ask/, round 72, T239) on a stand-in for the
 * attacker and an empty battle, and the flag the move carries afterwards. True
 * means the Protect check applies and the calc decides the rest (a quarter, or nothing); false means the move goes
 * through Protect untouched, so the calc gets no `isProtected` for it. A handler that needs the battle itself
 * leaves the move as it is. Z and Max moves would take a quarter in the simulator; nothing in the engine sets
 * `useZ` or `useMax`.
 */
type ModifyMoveHandler = (this: unknown, move: unknown, pokemon: unknown, target: unknown) => void;

export function protectBlocks(gen: CalcGeneration, moveName: string, attacker: CalcBody): boolean {
  const dex = simDexOf(gen);
  const move = dex.getActiveMove(moveName);
  if (!move.exists) return true;
  const handler = (dex.abilities.get(attacker.ability) as { onModifyMove?: unknown }).onModifyMove;
  if (typeof handler === 'function') {
    const user = { species: dex.species.get(attacker.species), transformed: false, formeChange: () => undefined };
    // A handler that needs the battle itself answers "needs more": the move keeps its flags. The stand-ins belong to this call alone.
    callHandler(handler as ModifyMoveHandler, {}, [move, user, null]);
  }
  return !!move.flags.protect;
}
