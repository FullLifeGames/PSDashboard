import type { Battle } from '@pkmn/sim';
import { protectKind } from '@fulllifegames/replay-core';

type BattleDex = Battle['dex'];
type DexMove = ReturnType<BattleDex['moves']['get']>;

/**
 * The Protect family as the engine's readers ask it, all on `protectKind` of replay-core; test/dex-facts-protect.spec.ts sweeps every move
 * of Gens 1 to 9 and Champions.
 */

/** A move that stops the hits on its user (Protect, Detect and their kin, Max Guard; Endure holds the user up and stops nothing). */
export const shieldsFromHits = (dex: BattleDex, move: DexMove): boolean => protectKind(dex, move) === 'shield';

/** A move that stops a class of hits on its user's whole side (Wide Guard, Quick Guard, Crafty Shield, Mat Block). */
export const shieldsSide = (dex: BattleDex, move: DexMove): boolean => protectKind(dex, move) === 'side';

/** A move whose success the simulator rolls against the stall counter: the shields and Endure, not the side protectors. */
export const rollsStall = (dex: BattleDex, move: DexMove): boolean => {
  const kind = protectKind(dex, move);
  // eslint-disable-next-line names/no-new-dex-name -- 'stall' is a ProtectKind (the simulator's stall counter), not the ability Stall
  return kind === 'shield' || kind === 'stall';
};

/** A move that changes what a foe's hit means (the shields, Endure, the side protectors). */
export const stopsHits = (dex: BattleDex, move: DexMove): boolean => protectKind(dex, move) !== null;
