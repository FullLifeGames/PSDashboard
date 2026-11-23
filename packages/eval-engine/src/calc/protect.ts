import { dexOfCalc, type CalcGeneration } from '@fulllifegames/replay-core';
import { callHandler } from '../sim-ask/index.ts';
import type { CalcBody } from './body.ts';

/**
 * Does Protect stop this move, as the simulator plays it? The calc prices every Unseen Fist hit into Protect at a quarter (0.12), while
 * the simulator deletes the protect flag of a contact move in the ability's onModifyMove (full damage) and keeps it in the Champions mod,
 * where the quarter comes from onHitProtect (as for Piercing Drill in every mod). Read from the move's flag after the attacker
 * ability's onModifyMove ran through `callHandler`. False: the calc gets no `isProtected`. Z and Max moves are not modelled.
 */
type ModifyMoveHandler = (this: unknown, move: unknown, pokemon: unknown, target: unknown) => void;

export function protectBlocks(gen: CalcGeneration, moveName: string, attacker: CalcBody): boolean {
  const dex = dexOfCalc(gen);
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
