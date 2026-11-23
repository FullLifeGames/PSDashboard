import type { TurnSnapshot } from '@fulllifegames/replay-core';
import type { SimBattle, SimPokemon } from './types.ts';
import { mayDisguise, shownIdsOfSnapshot, takeBodyOut, wasShownBody } from './team-order.ts';

/**
 * The bodies on the field that the log never shows, on a slot the log leaves empty. The simulator's replacement round sends a bench
 * body in where the log has none to send (it knocks out a body the log keeps at 1 HP, forces a replacement the log does not have), and
 * the correction revives the log's body from the snapshot. A slot the log leaves empty then means the game had nobody to send there, so
 * a body no snapshot entry names was never in the game: it leaves through `takeBodyOut` (End events included, no fallen-ally count).
 * Only an empty slot counts: where the log fills it, the sent-in body is an unrevealed body of a bring-all game (the singles ladder) and
 * stays on the bench. A body that may disguise itself (Illusion) stays. The side keeps the log's living body, so no win is called; the
 * returned bodies feed `retireBenchAfterFaints`.
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
