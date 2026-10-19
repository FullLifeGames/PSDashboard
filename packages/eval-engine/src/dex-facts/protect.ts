import type { Battle } from '@pkmn/sim';
import { protectKind } from '@fulllifegames/replay-core';

type BattleDex = Battle['dex'];
type DexMove = ReturnType<BattleDex['moves']['get']>;

/**
 * Round 72 (T235): the Protect family as the engine's readers ask it, all on `protectKind` of replay-core's dex-facts (one
 * read of the Dex, one memo per Dex). test/dex-facts-protect.spec.ts holds each reader to the form it replaced, over every
 * move of Generations 1 to 9 and the Champions mod.
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
