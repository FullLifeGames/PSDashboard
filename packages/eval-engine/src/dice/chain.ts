/**
 * Round 88 (T337, #73): the hits of a move whose every hit rolls its own accuracy (the Dex flag `multiaccuracy`: Triple Axel, Triple
 * Kick, Population Bomb), read from the game's own Dex. The log reader names the accuracy die of a later hit only for such a move:
 * the simulator draws one only there (Skill Link and Loaded Dice clear the flag while the move is in flight, and the die is then
 * never drawn). PURE, like `logged-results.ts`: a structural type for the Dex, so the main bundle may import it.
 */

import type { LoggedAction } from './logged-results.ts';
import type { ForcedDie } from './types.ts';

interface ChainDex { moves: { get(id: string): { multiaccuracy?: boolean; multihit?: number | number[] } } }

/** The number of hits of a multi-accuracy move in the game's Dex (`multihit`), or nothing for any other move. */
export function hitsIn(dex: ChainDex): (moveId: string) => number | undefined {
  return moveId => {
    const move = dex.moves.get(moveId);
    return move.multiaccuracy && typeof move.multihit === 'number' ? move.multihit : undefined;
  };
}

/**
 * The accuracy die of each later hit of a multi-accuracy move on a target it struck, from the hit count the log shows for it: hits 2 to the
 * count landed, and the next hit, when the move has one, missed. A faint or a sleep that ended the chain gives the simulator no draw for that
 * hit, and the die then reads `no-draw`: the forced turn ends the chain where the log did. An older replay keys the count by the side: with one
 * foe the one count is the target's. `hitsOf` is `LoggedOptions.hitsOf`.
 */
export function chainDice(action: LoggedAction, target: string, foes: readonly string[], hitsOf: ((moveId: string) => number | undefined) | undefined): ForcedDie[] {
  const hits = hitsOf?.(action.moveId);
  const counts = Object.values(action.hitCounts);
  const count = action.hitCounts[target] ?? (foes.length === 1 && counts.length === 1 ? counts[0] : undefined);
  if (!hits || count === undefined || !(count >= 1)) return [];
  const dice: ForcedDie[] = [];
  const hitDie = (hit: number, happens: boolean): ForcedDie => ({ name: { slot: action.slot, moveId: action.moveId, targetSlot: target, kind: 'accuracy', hit }, result: { happens } });
  for (let hit = 2; hit <= Math.min(count, hits); hit++) dice.push(hitDie(hit, true));
  if (count < hits) dice.push(hitDie(count + 1, false));
  return dice;
}
