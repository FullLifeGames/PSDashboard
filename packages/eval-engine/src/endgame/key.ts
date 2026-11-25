import { State } from '@pkmn/sim';
import type { Battle } from '@pkmn/sim';
import { rebaseClocks } from './board-facts.ts';

// The last move stays (Choice lock, Encore and Torment read it); dropping effectOrder is a small approximation.
const STRIPPED_FIELDS = [
  'log', 'inputLog', 'messageLog', 'sentLogPos', 'sentRequests', 'prng', 'prngSeed', 'turn', 'lastMoveLine',
  'hints', 'effectOrder',
] as const;

export function endgameKey(battle: Battle): string {
  const state = State.serializeBattle(battle) as Record<string, unknown>;
  for (const field of STRIPPED_FIELDS) delete state[field];
  rebaseClocks(state, battle);
  return JSON.stringify(state);
}
