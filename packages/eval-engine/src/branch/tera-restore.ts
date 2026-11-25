import { type TurnSnapshot, toId } from '@fulllifegames/replay-core';
import { sameBodyName } from './team-order.ts';
import type { SimBattle, SimPokemon } from './types.ts';

/** Tera changes more than the marker: Ogerpon and Terapagos change forme; Hunger Switch skips a Tera Morpeko. */
// oracle: packages/eval-engine/test/tera-forme-oracle.spec.ts
export const TERA_FORME_SPECIES = new Set(['Ogerpon', 'Terapagos', 'Morpeko']);

/** Restores the `terastallized` marker the sim deletes on faint, read from the snapshot alone. */
// |-terastallize| is no witness, and "the side spent its Tera and nobody carries it" is no trigger (true before gen 9).
export function restoreTeraFromSnapshot(battle: SimBattle, snapshot: TurnSnapshot) {
  if (battle.gen !== 9) return;
  for (let sideIdx = 0; sideIdx < 2; sideIdx++) {
    const snapshotSide = sideIdx === 0 ? snapshot.p1 : snapshot.p2;
    const side = battle.sides[sideIdx];
    const living = side.pokemon.filter((pokemon: SimPokemon) => !pokemon.fainted);
    if (living.some((pokemon: SimPokemon) => pokemon.terastallized)) continue;

    const entry = snapshotSide.pokemon.find(pokemon => pokemon.terastallized && !pokemon.fainted);
    if (!entry) continue;
    for (const ally of side.pokemon) ally.canTerastallize = null;

    if (side.pokemon.some((pokemon: SimPokemon) => pokemon.baseAbility === 'illusion')) continue;
    const bodies = living.filter((pokemon: SimPokemon) =>
      toId(pokemon.species?.name || '') === toId(entry.speciesForme) ||
      sameBodyName(pokemon.name, entry.name)
    );
    if (bodies.length !== 1 || TERA_FORME_SPECIES.has(bodies[0].species.baseSpecies)) continue;

    // Mirror of BattleActions#terastallize, minus the forme changes.
    const body = bodies[0];
    body.terastallized = entry.terastallized;
    body.addedType = '';
    body.knownType = true;
    body.apparentType = entry.terastallized;
  }
}
