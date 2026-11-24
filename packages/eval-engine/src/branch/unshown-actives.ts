import type { TurnSnapshot } from '@fulllifegames/replay-core';
import type { SimBattle, SimPokemon } from './types.ts';
import { mayDisguise, shownIdsOfSnapshot, takeBodyOut, wasShownBody } from './team-order.ts';

/** Retires bodies the sim sent into a slot the log leaves empty; a log-filled slot's body stays. */
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
