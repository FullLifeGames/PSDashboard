import { State } from '@pkmn/sim';
import type { Battle } from '@pkmn/sim';

/**
 * The endgame solver's memo key: the serialized state without logs, request bookkeeping, the PRNG, the turn counter and the effect-order
 * counter; the last move stays (Choice lock, Encore and Torment read it). Dropping effectOrder is a small approximation.
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
