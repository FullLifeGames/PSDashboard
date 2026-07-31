import { State } from '@pkmn/sim';
import type { Battle } from '@pkmn/sim';

/** Serializes a live battle into the engine's position-string format. */
export function serializeLiveBattle(battle: Battle): string {
  return JSON.stringify(State.serializeBattle(battle));
}
