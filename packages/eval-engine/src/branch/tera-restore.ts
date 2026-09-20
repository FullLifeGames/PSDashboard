import { type TurnSnapshot, toId } from '@fulllifegames/replay-core';
import type { SimBattle, SimPokemon } from './types.ts';

/** Species whose Tera click also changes forme and ability (Terapagos: max HP as well). */
const TERA_FORME_SPECIES = new Set(['Ogerpon', 'Terapagos', 'Morpeko']);

/**
 * The sim deletes `terastallized` in its faint block. A body that faints
 * only in the reconstruction (a guessed spread, a damage roll) and is
 * revived by the HP correction came back without the marker, while its side
 * had already spent the Tera: 17 of 833 bank positions stood one Tera body
 * short and none over (round 54). A click the sim swallowed without an error
 * (a locked move, Struggle) or answered with its default after a rejected
 * choice leaves the same hole, with the side's Tera still armed. The
 * snapshot alone decides: it carries the marker per body at every boundary,
 * for the field and the bench, and drops it on a real faint, so a body
 * Revival Blessing brought back stays without it as in the game. The
 * |-terastallize| line is no witness (it stands in the log long after the
 * body fell), and "the side spent its Tera and nobody carries it" is no
 * trigger: that holds in every battle before gen 9 and after every real
 * faint of a Tera body.
 *
 * A living terastallized entry proves the side spent its Tera, so the side
 * loses it first, whatever happens to the marker: the search must never
 * offer a second Terastallization. The marker itself is left alone on a side
 * with an Illusion holder (the protocol names the disguise), for an entry
 * that matches no body or more than one, and for Ogerpon, Terapagos and
 * Morpeko, whose click also changes forme and ability and whose faint
 * regresses the forme. A bare marker would leave half a Tera there; the
 * marker's loss stays on those bodies. A side that already carries a marker
 * is done (one Tera per battle).
 */
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
      toId(pokemon.name || '') === toId(entry.name)
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
