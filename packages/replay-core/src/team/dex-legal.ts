import type { PokemonSet } from '@pkmn/sim';
import { Dex } from '@pkmn/sim';
import { toId } from '../ids.ts';

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
 * - T79, outside custom games: a fixed Tera type or item from the dex.
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

/** The species' first ability slot in the replay's generation (Gengar: Levitate in gen 6, Cursed Body from gen 7). */
function slotZeroAbility(dex: GenDex, species: string): string | undefined {
  const slots = dex.species.get(species).abilities;
  return slots[0] || slots[1] || slots.H || undefined;
}

/**
 * Whether the replay's format lets any species hold any ability: the sim's
 * rule table answers for a format it knows (Custom Game, Balanced and Pure
 * Hackmons, Hackmons Cup carry no 'obtainableabilities'); for one it does
 * not know (a newer VGC regulation, a draft league) only a custom game counts.
 */
export function abilitiesAreFree(log: string): boolean {
  const tier = log.match(/^\|tier\|(.*)$/m)?.[1] ?? '';
  const format = Dex.formats.get(tier);
  if (format.exists) return !Dex.formats.getRuleTable(format).has('obtainableabilities');
  return /custom game/i.test(tier);
}

export function legalAbility(set: PokemonSet, context: LegalityContext): string {
  if (context.gen < 3 || !set.ability) return set.ability;
  const dex = Dex.forGen(context.gen);
  if (!dex.species.get(set.species).exists) return set.ability;
  const id = toId(set.ability);
  if (ownAbilities(dex, set.species).some(name => toId(name) === id)) return set.ability;
  if (!dex.abilities.get(set.ability).exists) return speciesAbilityFor(dex, set.species, set.ability) ?? set.ability;
  if (!context.custom && battleOnlyAbilityIds(dex, set.species).has(id)) return slotZeroAbility(dex, set.species) ?? set.ability;
  return set.ability;
}

/**
 * T79, outside custom games: a species with a fixed Tera type or item
 * (requiredTeraType, requiredItem: Ogerpon's masks, Terapagos) carries it.
 * Without one the sim takes the species' first type as Tera type
 * (pokemon.js:209 `set.teraType || types[0]`): Ogerpon-Cornerstone would
 * terastallize into Grass instead of Rock.
 */
export function withRequiredFields(set: PokemonSet, context: LegalityContext): PokemonSet {
  if (context.custom) return set;
  const species = Dex.forGen(context.gen).species.get(set.species);
  if (!species.exists) return set;
  const teraType = !set.teraType && species.requiredTeraType ? species.requiredTeraType : set.teraType;
  const item = species.requiredItem && toId(set.item) !== toId(species.requiredItem) ? species.requiredItem : set.item;
  return teraType === set.teraType && item === set.item ? set : { ...set, teraType, item };
}

/** A set the simulator can play; the same object when no rule fires. */
export function dexLegalSet(set: PokemonSet, context: LegalityContext): PokemonSet {
  const ability = legalAbility(set, context);
  return withRequiredFields(ability === set.ability ? set : { ...set, ability }, context);
}
