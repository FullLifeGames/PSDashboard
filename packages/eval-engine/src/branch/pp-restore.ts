import { toId, type TurnSnapshot } from '@fulllifegames/replay-core';
import type { SimBattle, SimPokemon, SimSide } from './types.ts';

type BodyOf = (side: SimSide, snapshotPokemon: TurnSnapshot['p1']['pokemon'][number]) => SimPokemon | undefined;

/**
 * Sets each move's PP from the log's count of its uses (`ppUsed` of the snapshot, read by @pkmn/client) and returns whether a slot moved
 * (the request was built from the old PP). The rebuild drifts from the game: a Leppa Berry the set guessed restores the move, and a turn
 * played differently never spends it, so a move at 0 PP in the game (Revival Blessing, 1 PP) would rank first again. A range of spent
 * PP (Pressure left open) clamps the slot into it.
 */
export function restorePpFromSnapshot(battle: SimBattle, snapshot: TurnSnapshot, bodyOf: BodyOf): boolean {
  let changed = false;
  for (let sideIndex = 0; sideIndex < 2; sideIndex++) {
    for (const snapshotPokemon of [snapshot.p1, snapshot.p2][sideIndex].pokemon) {
      if (!snapshotPokemon.ppUsed) continue;
      const body = bodyOf(battle.sides[sideIndex], snapshotPokemon);
      if (!body) continue;
      const spentById = new Map(Object.entries(snapshotPokemon.ppUsed).map(([name, spent]) => [toId(name), spent]));
      const slots = new Set<SimPokemon['baseMoveSlots'][number]>(body.baseMoveSlots);
      // The slots are one object each until a Transform copies them; the copies are the target's moves and stay out.
      if (!body.volatiles.transform) for (const slot of body.moveSlots) slots.add(slot);
      for (const slot of slots) {
        const spent = spentById.get(slot.id);
        if (spent === undefined) continue;
        const [least, most] = typeof spent === 'number' ? [spent, spent] : spent;
        const pp = Math.min(Math.max(slot.pp, slot.maxpp - most), Math.max(0, slot.maxpp - least));
        if (pp === slot.pp) continue;
        slot.pp = Math.max(0, pp);
        changed = true;
      }
    }
  }
  return changed;
}
