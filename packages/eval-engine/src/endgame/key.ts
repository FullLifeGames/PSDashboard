import { State } from '@pkmn/sim';
import type { Battle } from '@pkmn/sim';

/**
 * The endgame solver's memo key (round 34): the sim's serialized state
 * without everything that differs between two paths to the same board.
 * Logs and request bookkeeping, the PRNG, the turn counter, and the
 * effect-order counter are dropped; HP, PP, status, boosts, volatiles,
 * field state, and the last move used stay (Choice lock, Encore, and
 * Torment read the last move, so two boards that differ only there are
 * different positions). Dropping effectOrder is a small approximation
 * (two paths may have booked simultaneous effects in another order).
 */
const STRIPPED_FIELDS = [
  'log', 'inputLog', 'messageLog', 'sentLogPos', 'sentRequests', 'prng', 'prngSeed', 'turn', 'lastMoveLine',
  'hints', 'effectOrder',
] as const;

export function endgameKey(battle: Battle): string {
  const state = State.serializeBattle(battle) as Record<string, unknown>;
  for (const field of STRIPPED_FIELDS) delete state[field];
  return JSON.stringify(state);
}
