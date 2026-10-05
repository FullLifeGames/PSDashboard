import { Dex } from '@pkmn/dex';
import type { PokemonSet } from '@pkmn/sim';
import type { SpeedOrderObservation } from '../types.ts';
import { toId } from '../ids.ts';

/**
 * T117 (round 63): an observed move order is a hard limit on the built
 * sets. This module reads the orders the way the solver can measure them.
 */

const named = (sets: PokemonSet[], species: string) =>
  sets.some(set => toId(set.species) === toId(species) || toId(set.name || '') === toId(species));

/**
 * The set an order's mover raced as: its own species, or the set of the
 * forme a battle-only forme comes from (Ogerpon's Tera masks) when both run
 * on the same base Speed. A forme with its own Speed (a Mega after its
 * evolution, Terapagos-Terastal) stays unread: the set's Speed is not the
 * one that raced.
 */
function racedAs(sets: PokemonSet[], species: string): string {
  if (named(sets, species)) return species;
  const forme = Dex.species.get(species);
  const origin = [forme.battleOnly ?? []].flat()
    .map(name => Dex.species.get(name))
    .find(base => base.exists && base.baseStats.spe === forme.baseStats.spe && named(sets, base.name));
  return origin?.name ?? species;
}

/** The orders with each mover named as the set that raced. */
export function readableOrders(orders: SpeedOrderObservation[], sets: { p1: PokemonSet[]; p2: PokemonSet[] }): SpeedOrderObservation[] {
  return orders.map(order => {
    const firstSpecies = racedAs(sets[order.firstSide], order.firstSpecies);
    const secondSpecies = racedAs(sets[order.secondSide], order.secondSpecies);
    return firstSpecies === order.firstSpecies && secondSpecies === order.secondSpecies
      ? order : { ...order, firstSpecies, secondSpecies };
  });
}
