import { toID } from '@pkmn/sim';
import { twinBattle } from '@fulllifegames/replay-core';
import { isChampionsSimFormat, simModsReady } from '../forward/sim-mods.ts';

export { twinBattle };

/** The custom game of a generation, or the Champions format once the mod is registered; null before. */
export function twinFormat(gen: number, champions: boolean): string | null {
  const format = toID(champions ? 'gen9championsou' : `gen${gen}customgame`);
  return isChampionsSimFormat(format) && !simModsReady(format) ? null : format;
}
