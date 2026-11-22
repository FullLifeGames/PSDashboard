import { toId, type TurnSnapshot } from '@fulllifegames/replay-core';
import type { SimBattle, SimPokemon, SimSide } from './types.ts';

type BodyOf = (side: SimSide, snapshotPokemon: TurnSnapshot['p1']['pokemon'][number]) => SimPokemon | undefined;

/**
 * Round 89 (#106): the PP a move has left is the log's count of its uses, not the rebuilt battle's. The rebuild spends PP by the
 * moves it plays, and it drifts from the game in two ways: a Leppa Berry the log rules out (the set guessed it, the game never
 * showed it) restores the move, and a turn the rebuild played differently (a faint before the body acted) never spends it. A
 * move at 0 PP in the game then ranks first in the rebuilt one (Revival Blessing, 1 PP, used and offered again).
 *
 * The snapshot carries the PP the log shows spent per move (`ppUsed`, read by @pkmn/client: Pressure charges its extra point, a
 * Leppa or Mystery Berry in the log takes its points back). Each own move slot of a body takes the simulator's own maximum minus
 * that count; a range (Pressure left open) clamps the slot into it. A move the log never shows used reads 0 spent, as the
 * simulator's slot of a move nobody used does. A snapshot without the field (written before round 89) changes nothing.
 * Returns whether a slot moved: the request was built from the old PP and needs a refresh.
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
