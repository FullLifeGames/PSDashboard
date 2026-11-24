/**
 * The hits of a move whose every hit rolls its own accuracy (the Dex flag `multiaccuracy`: Triple Axel, Triple Kick, Population Bomb).
 * The log reader names the accuracy die of a later hit only for such a move: the simulator draws one only there (Skill Link and Loaded
 * Dice clear the flag while the move is in flight). Pure, with a structural Dex type, so the main bundle may import it.
 */

import type { LoggedAction } from './logged-results.ts';
import type { ForcedDie } from './types.ts';

interface ChainDex { moves: { get(id: string): { multiaccuracy?: boolean; multihit?: number | number[] } } }

export function hitsIn(dex: ChainDex): (moveId: string) => number | undefined {
  return moveId => {
    const move = dex.moves.get(moveId);
    return move.multiaccuracy && typeof move.multihit === 'number' ? move.multihit : undefined;
  };
}

/** The accuracy result of one later hit (`hit` 2 and up) of a multi-accuracy move: it lands or it misses. */
export interface HitResult { hit: number; happens: boolean }

/** The accuracy results a count of landed hits stands for: hits 2 to the count landing, then the next hit missing; above the hits is the full chain, below one none. */
export function chainResults(count: number, hits: number): HitResult[] {
  if (!(count >= 1)) return [];
  const landed = Math.min(Math.floor(count), hits);
  const results: HitResult[] = [];
  for (let hit = 2; hit <= landed; hit++) results.push({ hit, happens: true });
  if (landed < hits) results.push({ hit: landed + 1, happens: false });
  return results;
}

/** The inverse of `chainResults`: the hits that landed in a row from the first hit, from the results set so far (a hit with no result ends the run). */
export function chainCount(results: readonly HitResult[]): number {
  const landed = new Set(results.filter(result => result.happens).map(result => result.hit));
  let count = 1;
  while (landed.has(count + 1)) count++;
  return count;
}

/**
 * The accuracy die of each later hit of a multi-accuracy move on a target it struck, from the hit count the log shows for it
 * (`chainResults`). A faint or a sleep that ended the chain gives the simulator no draw for that hit, and the die then reads `no-draw`.
 * An older replay keys the count by the side: with one foe the one count is the target's. `hitsOf` is `LoggedOptions.hitsOf`.
 */
export function chainDice(action: LoggedAction, target: string, foes: readonly string[], hitsOf: ((moveId: string) => number | undefined) | undefined): ForcedDie[] {
  const hits = hitsOf?.(action.moveId);
  const counts = Object.values(action.hitCounts);
  const count = action.hitCounts[target] ?? (foes.length === 1 && counts.length === 1 ? counts[0] : undefined);
  if (!hits || count === undefined || !(count >= 1)) return [];
  return chainResults(count, hits).map(({ hit, happens }): ForcedDie => ({ name: { slot: action.slot, moveId: action.moveId, targetSlot: target, kind: 'accuracy', hit }, result: { happens } }));
}
