import { toID } from '@pkmn/sim';
import { twinBattle } from '@fulllifegames/replay-core';
import { isChampionsSimFormat, simModsReady } from '../forward/sim-mods.ts';

/**
 * Round 72 (T239): the twin battle, from replay-core (the spread solver there asks the same twin and cannot import
 * this package), and the format a twin of a generation plays on. A Champions twin exists only where the mod is
 * registered: before that `twinFormat` answers null and nothing is built or remembered.
 */
export { twinBattle };

/** The custom game of a generation, or the Champions format after the mod is registered; null where it is not yet. */
export function twinFormat(gen: number, champions: boolean): string | null {
  const format = toID(champions ? 'gen9championsou' : `gen${gen}customgame`);
  return isChampionsSimFormat(format) && !simModsReady(format) ? null : format;
}
