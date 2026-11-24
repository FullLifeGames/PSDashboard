import type { Battle } from '@pkmn/sim';
import { protectKind } from '@fulllifegames/replay-core';

type BattleDex = Battle['dex'];
type DexMove = ReturnType<BattleDex['moves']['get']>;

/** All on `protectKind` of replay-core; dex-facts-protect.spec.ts sweeps every move of Gens 1 to 9 and Champions. */

export const shieldsFromHits = (dex: BattleDex, move: DexMove): boolean => protectKind(dex, move) === 'shield';

export const shieldsSide = (dex: BattleDex, move: DexMove): boolean => protectKind(dex, move) === 'side';

/** A move whose success rolls against the stall counter: the shields and Endure, not the side protectors. */
export const rollsStall = (dex: BattleDex, move: DexMove): boolean => {
  const kind = protectKind(dex, move);
  // eslint-disable-next-line names/no-new-dex-name -- 'stall' is a ProtectKind (the simulator's stall counter), not the ability Stall
  return kind === 'shield' || kind === 'stall';
};

export const stopsHits = (dex: BattleDex, move: DexMove): boolean => protectKind(dex, move) !== null;
