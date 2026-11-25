import { dexOfCalc, type CalcGeneration } from '@fulllifegames/replay-core';
import { callHandler } from '../sim-ask/index.ts';
import type { CalcBody } from './body.ts';

// The calc quarters Unseen Fist hits into Protect; the simulator deletes a contact move's protect flag (full damage) in
// the ability's onModifyMove, except in the Champions mod, where the quarter comes from onHitProtect.
type ModifyMoveHandler = (this: unknown, move: unknown, pokemon: unknown, target: unknown) => void;

export function protectBlocks(gen: CalcGeneration, moveName: string, attacker: CalcBody): boolean {
  const dex = dexOfCalc(gen);
  const move = dex.getActiveMove(moveName);
  if (!move.exists) return true;
  const handler = (dex.abilities.get(attacker.ability) as { onModifyMove?: unknown }).onModifyMove;
  if (typeof handler === 'function') {
    const user = { species: dex.species.get(attacker.species), transformed: false, formeChange: () => undefined };
    // A handler that needs the battle itself leaves the move's flags as they are.
    callHandler(handler as ModifyMoveHandler, {}, [move, user, null]);
  }
  return !!move.flags.protect;
}
