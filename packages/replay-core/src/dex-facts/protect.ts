import { factsOfDex, type FactsDex, type ProtectKind } from './facts.ts';

type DexMove = ReturnType<FactsDex['moves']['get']>;

/** The Protect family of a move, from the Dex entry's fields only (null outside it); `side` rolls no stall counter. */
export function protectKind(dex: FactsDex, move: DexMove): ProtectKind | null {
  const memo = factsOfDex(dex).protect;
  let kind = memo.get(move.id);
  if (kind === undefined) memo.set(move.id, kind = readKind(dex, move));
  return kind;
}

function readKind(dex: FactsDex, move: DexMove): ProtectKind | null {
  if (move.target === 'self' && move.stallingMove && move.volatileStatus) {
    // eslint-disable-next-line names/no-new-dex-name -- 'stall' is a ProtectKind (the simulator's stall counter), not the ability Stall
    return 'onTryHit' in dex.conditions.get(move.volatileStatus) ? 'shield' : 'stall';
  }
  if (move.target === 'allySide' && move.sideCondition && 'onTryHit' in dex.conditions.get(move.sideCondition)) return 'side';
  return null;
}
