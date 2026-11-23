import type { PokemonSet } from '@pkmn/sim';
import { toId } from '../ids.ts';
import { dexOf, simFormats, type GameRules, type RulesDex } from '../rules-dex.ts';

/** Sets the simulator can play: the rules read only the dex of the replay's generation, never a species or ability name. */

export type GenDex = RulesDex;

export interface LegalityContext extends GameRules {
  /** A format with free abilities (abilitiesAreFree): players may give any species any ability or item. */
  freeAbilities: boolean;
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
 * Whether the format lets any species hold any ability, by the sim's rule table (Balanced and Pure Hackmons and Hackmons Cup carry no
 * 'obtainableabilities').
 */
export function abilitiesAreFree(log: string): boolean {
  const tier = log.match(/^\|tier\|(.*)$/m)?.[1] ?? '';
  const format = simFormats().get(tier);
  // A custom game keeps each species to its own abilities, although the sim's Custom Game checks none: draft leagues play as custom games under
  // the usual abilities (Noivern can never have Magic Guard). A format the sim does not know (a newer VGC regulation, a league's name) counts the same way.
  if (!format.exists || format.id.endsWith('customgame')) return false;
  return !simFormats().getRuleTable(format).has('obtainableabilities');
}

/** The ability the simulator plays for a set: the species' own ability the log's name maps to, else its default where only a battle-only forme has it. */
export function legalAbility(set: PokemonSet, context: LegalityContext): string {
  if (context.gen < 3 || !set.ability) return set.ability;
  const dex = dexOf(context);
  if (!dex.species.get(set.species).exists) return set.ability;
  const id = toId(set.ability);
  if (ownAbilities(dex, set.species).some(name => toId(name) === id)) return set.ability;
  // The sim plays an unknown ability id as no ability (pokemon.js:184 takes toID(set.ability); the engine's battles never validate
  // teams): the log's "As One" becomes the species' own ability whose id starts with it, "As One (Spectrier)".
  if (!dex.abilities.get(set.ability).exists) return speciesAbilityFor(dex, set.species, set.ability) ?? set.ability;
  // Outside free-ability formats, an ability only a battle-only forme of the base carries (Ogerpon before its Tera, Terapagos)
  // becomes the species' default; in Balanced Hackmons any ability can be real.
  if (!context.freeAbilities && battleOnlyAbilityIds(dex, set.species).has(id)) return slotZeroAbility(dex, set.species) ?? set.ability;
  return set.ability;
}

/** Outside free-ability formats, a species with a fixed Tera type or item (requiredTeraType, requiredItem: Ogerpon's masks, Terapagos) carries it. */
export function withRequiredFields(set: PokemonSet, context: LegalityContext): PokemonSet {
  // Without a fixed one the sim takes the species' first type as Tera type (pokemon.js:209 `set.teraType || types[0]`):
  // Ogerpon-Cornerstone would terastallize into Grass.
  if (context.freeAbilities) return set;
  const species = dexOf(context).species.get(set.species);
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
