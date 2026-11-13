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

/** The accuracy result of one later hit (`hit` 2 and up) of a multi-accuracy move: it lands or it misses. */
export interface HitResult { hit: number; happens: boolean }

/**
 * Round 89 (#114, F2): the chain rule, once. A count of `count` landed hits of a move with `hits` hits stands for hits 2 to the count
 * landing and, when the move has a next hit, that hit missing (the first hit has its own plain die and is not in the list). A count
 * above the hits reads as the full chain, a count below one as no chain.
 */
export function chainResults(count: number, hits: number): HitResult[] {
  if (!(count >= 1)) return [];
  const landed = Math.min(Math.floor(count), hits);
  const results: HitResult[] = [];
  for (let hit = 2; hit <= landed; hit++) results.push({ hit, happens: true });
  if (landed < hits) results.push({ hit: landed + 1, happens: false });
  return results;
}

/** The inverse of `chainResults`: the hits that landed in a row from the first hit, read from the results set so far (a hit with no result is unset and ends the run). */
export function chainCount(results: readonly HitResult[]): number {
  const landed = new Set(results.filter(result => result.happens).map(result => result.hit));
  let count = 1;
  while (landed.has(count + 1)) count++;
  return count;
}

/**
 * The accuracy die of each later hit of a multi-accuracy move on a target it struck, from the hit count the log shows for it: hits 2 to the
 * count landed, and the next hit, when the move has one, missed (`chainResults`). A faint or a sleep that ended the chain gives the simulator no draw for that
 * hit, and the die then reads `no-draw`: the forced turn ends the chain where the log did. An older replay keys the count by the side: with one
 * foe the one count is the target's. `hitsOf` is `LoggedOptions.hitsOf`.
 */
export function chainDice(action: LoggedAction, target: string, foes: readonly string[], hitsOf: ((moveId: string) => number | undefined) | undefined): ForcedDie[] {
  const hits = hitsOf?.(action.moveId);
  const counts = Object.values(action.hitCounts);
  const count = action.hitCounts[target] ?? (foes.length === 1 && counts.length === 1 ? counts[0] : undefined);
  if (!hits || count === undefined || !(count >= 1)) return [];
  return chainResults(count, hits).map(({ hit, happens }): ForcedDie => ({ name: { slot: action.slot, moveId: action.moveId, targetSlot: target, kind: 'accuracy', hit }, result: { happens } }));
}
