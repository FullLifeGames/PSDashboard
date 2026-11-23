import { toID } from '@pkmn/sim';
import { twinBattle } from '@fulllifegames/replay-core';
import { isChampionsSimFormat, simModsReady } from '../forward/sim-mods.ts';

// The twin battle comes from replay-core (its spread solver asks the same twin and cannot import this package).
export { twinBattle };

/** The custom game of a generation, or the Champions format after the mod is registered; null where it is not yet. */
export function twinFormat(gen: number, champions: boolean): string | null {
  const format = toID(champions ? 'gen9championsou' : `gen${gen}customgame`);
  return isChampionsSimFormat(format) && !simModsReady(format) ? null : format;
}
