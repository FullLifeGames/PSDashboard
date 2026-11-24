import type { Battle } from '@pkmn/sim';
import { serializeBattleStable } from './forward-model.ts';

export function serializeLiveBattle(battle: Battle): string {
  return serializeBattleStable(battle);
}
