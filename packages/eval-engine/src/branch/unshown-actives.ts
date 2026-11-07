import type { TurnSnapshot } from '@fulllifegames/replay-core';
import type { SimBattle, SimPokemon } from './types.ts';
import { mayDisguise, shownIdsOfSnapshot, takeBodyOut, wasShownBody } from './team-order.ts';

/**
 * Round 88 (T327, #63): the bodies on the field that the log never shows, on a slot the log leaves empty. The simulator's replacement
 * round sends a bench body in where the log has none to send: it knocks out a body that the log keeps at 1 hit point (VGC 2565721987
 * turn 5), forces a replacement the log does not have, and the correction revives the log's body from the snapshot. A slot that the
 * log leaves empty after the revived and repointed bodies stand means the game had nobody to send there, so a body that no entry of
 * the snapshot names was never in the game: it leaves through `takeBodyOut` (on the field, End events included, no fallen-ally
 * count), and its slot stays empty as the log's slot is. The guard of `retireUnshownBench` stays as it is: it refuses where the
 * simulator forces a slot the log did not faint, and a body taken out there would end a game the log goes on with. Here the side
 * keeps the log's living body (`desired` is not empty), so no win is called.
 *
 * Only a slot the log leaves empty counts. Where the log fills the slot, the body the simulator sent in is an unrevealed body of a
 * bring-all game (the singles ladder) and stays alive on the bench once the correction repointed the log's body into its slot.
 * A body that may disguise itself (Illusion) may be a shown body and stays. The returned bodies feed `retireBenchAfterFaints`, which
 * retires the bench bodies the log never shows behind the empty slot under its own guards.
 */
export function retireUnshownActives(battle: SimBattle, snapshot: TurnSnapshot): Set<SimPokemon> {
  const out = new Set<SimPokemon>();
  for (let sideIdx = 0; sideIdx < 2; sideIdx++) {
    const side = battle.sides[sideIdx];
    const snapshotSide = sideIdx === 0 ? snapshot.p1 : snapshot.p2;
    const standing = snapshotSide.pokemon.filter(pokemon => pokemon.isActive && !pokemon.fainted);
    if (standing.length === 0 || standing.length >= side.active.length) continue;
    const shown = shownIdsOfSnapshot(battle, snapshotSide.pokemon.filter(entry => entry.maxhp > 0));
    for (const body of side.active) {
      if (!body || body.fainted || wasShownBody(body, shown) || mayDisguise(body)) continue;
      takeBodyOut(body, { fallen: false });
      out.add(body);
    }
  }
  return out;
}
