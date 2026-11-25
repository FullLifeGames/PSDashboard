// Hits of a multiaccuracy move (Triple Axel, Triple Kick, Population Bomb): only there does the simulator draw a later
// hit's die (Skill Link, Loaded Dice clear the flag in flight). Pure, with a structural Dex type: main-bundle safe.

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

/** Hits 2 to the count land, then the next hit misses; above the hits is the full chain, below one none. */
export function chainResults(count: number, hits: number): HitResult[] {
  if (!(count >= 1)) return [];
  const landed = Math.min(Math.floor(count), hits);
  const results: HitResult[] = [];
  for (let hit = 2; hit <= landed; hit++) results.push({ hit, happens: true });
  if (landed < hits) results.push({ hit: landed + 1, happens: false });
  return results;
}

/** The inverse of `chainResults`: the hits that landed in a row from the first; a hit with no result ends the run. */
export function chainCount(results: readonly HitResult[]): number {
  const landed = new Set(results.filter(result => result.happens).map(result => result.hit));
  let count = 1;
  while (landed.has(count + 1)) count++;
  return count;
}

/** A faint or a sleep that ended the chain gives the simulator no draw for that hit: the die reads no-draw. */
export function chainDice(action: LoggedAction, target: string, foes: readonly string[], hitsOf: ((moveId: string) => number | undefined) | undefined): ForcedDie[] {
  const hits = hitsOf?.(action.moveId);
  const counts = Object.values(action.hitCounts);
  const count = action.hitCounts[target] ?? (foes.length === 1 && counts.length === 1 ? counts[0] : undefined);
  if (!hits || count === undefined || !(count >= 1)) return [];
  return chainResults(count, hits).map(({ hit, happens }): ForcedDie => ({ name: { slot: action.slot, moveId: action.moveId, targetSlot: target, kind: 'accuracy', hit }, result: { happens } }));
}
