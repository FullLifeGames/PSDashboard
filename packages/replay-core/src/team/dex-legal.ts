import type { PokemonSet } from '@pkmn/sim';
import { Dex } from '@pkmn/sim';
import { toId } from '../ids.ts';
import { defaultAbility } from './set-resolvers.ts';

/**
 * Sets the simulator can play (round 60). The rules read only the dex of the
 * replay's generation, never a species or ability name. The sim plays an
 * unknown ability id as no ability at all (pokemon.js:184 takes
 * toID(set.ability); the engine's battles never validate teams).
 * - T93 rule 1: an ability name the dex does not know becomes the species'
 *   own ability whose id starts with it (the log writes "As One", the dex
 *   knows "As One (Spectrier)").
 * - T93 rule 2, outside custom games: an ability only a battle-only forme of
 *   the species' base carries becomes the species' default (Ogerpon before
 *   its Tera, Terapagos); in a custom game any ability can be real.
 */

export type GenDex = ReturnType<typeof Dex.forGen>;

export interface LegalityContext {
  gen: number;
  /** A custom game: players may give any species any ability or item. */
  custom: boolean;
}

function ownAbilities(dex: GenDex, species: string): string[] {
  return Object.values(dex.species.get(species).abilities ?? {}).filter((name): name is string => !!name);
}

/** The species' ability matching a name: the same id, else the one whose id starts with it. */
export function speciesAbilityFor(dex: GenDex, species: string, abilityName: string): string | undefined {
  const id = toId(abilityName);
  if (!id) return undefined;
  const own = ownAbilities(dex, species);
  return own.find(name => toId(name) === id) ?? own.find(name => toId(name).startsWith(id));
}

/** Ability ids only battle-only formes of the species' base carry, minus the species' own. */
function battleOnlyAbilityIds(dex: GenDex, species: string): Set<string> {
  const base = dex.species.get(dex.species.get(species).baseSpecies);
  const ids = new Set<string>();
  for (const forme of base.formeOrder ?? []) {
    const entry = dex.species.get(forme);
    if (!entry.battleOnly) continue;
    for (const name of ownAbilities(dex, entry.name)) ids.add(toId(name));
  }
  for (const name of ownAbilities(dex, species)) ids.delete(toId(name));
  return ids;
}

export function legalAbility(set: PokemonSet, context: LegalityContext): string {
  if (context.gen < 3 || !set.ability) return set.ability;
  const dex = Dex.forGen(context.gen);
  if (!dex.species.get(set.species).exists) return set.ability;
  const id = toId(set.ability);
  if (ownAbilities(dex, set.species).some(name => toId(name) === id)) return set.ability;
  if (!dex.abilities.get(set.ability).exists) return speciesAbilityFor(dex, set.species, set.ability) ?? set.ability;
  if (!context.custom && battleOnlyAbilityIds(dex, set.species).has(id)) return defaultAbility(set.species);
  return set.ability;
}

/** A set the simulator can play; the same object when no rule fires. */
export function dexLegalSet(set: PokemonSet, context: LegalityContext): PokemonSet {
  const ability = legalAbility(set, context);
  return ability === set.ability ? set : { ...set, ability };
}
