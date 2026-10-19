import { factsOfDex, type FactsDex, type ProtectKind } from './facts.ts';

type DexMove = ReturnType<FactsDex['moves']['get']>;

/**
 * The Protect family, read from the Dex in one place (round 72, T235; five forms in damage-calc.ts, pair/guards.ts,
 * search/hints.ts and cell-blend.ts before). Three kinds, the same in every generation and in the Champions mod:
 *
 * - `shield`: a self-targeted stalling move whose volatile stops moves (`onTryHit`): Protect, Detect, the King's Shield kin
 *   and Max Guard. The stall counter rolls its success.
 * - `stall`: the same move whose volatile has no `onTryHit`: Endure holds the user at 1 HP and rolls the counter the same way.
 * - `side`: an ally-side move whose side condition stops a class of hits (`onTryHit`): Wide Guard, Quick Guard, Crafty Shield,
 *   Mat Block. They set a side condition, and their success is not rolled.
 *
 * A move outside the family answers null. The question reads fields of the Dex entry only; whether a shield stops a given
 * hit is the simulator's call (search/hints.ts protectorStops, which runs its handler on stand-ins).
 */
export function protectKind(dex: FactsDex, move: DexMove): ProtectKind | null {
  const memo = factsOfDex(dex).protect;
  let kind = memo.get(move.id);
  if (kind === undefined) memo.set(move.id, kind = readKind(dex, move));
  return kind;
}

function readKind(dex: FactsDex, move: DexMove): ProtectKind | null {
  if (move.target === 'self' && move.stallingMove && move.volatileStatus) {
    return 'onTryHit' in dex.conditions.get(move.volatileStatus) ? 'shield' : 'stall';
  }
  if (move.target === 'allySide' && move.sideCondition && 'onTryHit' in dex.conditions.get(move.sideCondition)) return 'side';
  return null;
}
