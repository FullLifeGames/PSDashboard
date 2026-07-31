import type { Battle } from '@pkmn/sim';
import { serializeBattleStable } from './forward-model';

/** Serializes a live battle into the engine's position-string format. */
export function serializeLiveBattle(battle: Battle): string {
  return serializeBattleStable(battle);
}
