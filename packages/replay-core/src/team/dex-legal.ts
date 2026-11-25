import { TeamValidator, type PokemonSet } from '@pkmn/sim';
import { toId } from '../ids.ts';
import { dexOf, logRules, simFormats, type GameRules, type RulesDex } from '../rules-dex.ts';

/** The rules read only the Dex of the replay's generation, never a species or ability name. */

export type GenDex = RulesDex;

export interface LegalityContext extends GameRules {
  /** A format with free abilities (abilitiesAreFree): players may give any species any ability or item. */
  freeAbilities: boolean;
  /** Ability ids the format bans; undefined reads as none. */
  bannedAbilities?: ReadonlySet<string>;
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

// The first slot depends on the generation (Gengar: Levitate in gen 6, Cursed Body from gen 7).
function slotZeroAbility(dex: GenDex, species: string): string | undefined {
  const slots = dex.species.get(species).abilities;
  return slots[0] || slots[1] || slots.H || undefined;
}

/** Whether the format lets any species hold any ability: Hackmons formats carry no 'obtainableabilities' rule. */
export function abilitiesAreFree(log: string): boolean {
  const tier = log.match(/^\|tier\|(.*)$/m)?.[1] ?? '';
  const format = simFormats().get(tier);
  // A custom game keeps each species to its own abilities (draft leagues); a format the sim does not know does too.
  if (!format.exists || format.id.endsWith('customgame')) return false;
  return !simFormats().getRuleTable(format).has('obtainableabilities');
}

const bansByFormat = new Map<string, ReadonlySet<string>>();

function bansOfFormat(formatId: string): ReadonlySet<string> {
  const known = bansByFormat.get(formatId);
  if (known) return known;
  const validator = new TeamValidator(formatId);
  const probe = { name: '', species: '' } as unknown as PokemonSet;
  const bans = new Set(validator.dex.abilities.all().filter(ability => ability.exists && validator.checkAbility(probe, ability, {})).map(ability => ability.id));
  bansByFormat.set(formatId, bans);
  return bans;
}

/** The ability ids the log's format bans: its validator, else one per `|rule|` line (a joined list loses rules). */
export function formatAbilityBans(log: string): ReadonlySet<string> {
  const format = simFormats().get(/^\|tier\|(.*)$/m.exec(log)?.[1] ?? '');
  if (format.exists && !format.id.endsWith('customgame')) return bansOfFormat(format.id);
  const rules = logRules(log);
  const base = `gen${rules.gen}${rules.mod ?? ''}customgame`;
  const bans = new Set<string>();
  if (!simFormats().get(base).exists) return bans;
  for (const [, name] of log.matchAll(/^\|rule\|([^|\n:]+): /gm)) {
    if (simFormats().get(name).effectType !== 'ValidatorRule') continue;
    for (const id of bansOfFormat(`${base}@@@${name}`)) bans.add(id);
  }
  return bans;
}

/** The first of the species' slots 0, 1, H that `skip` lets pass; slot 0 when every slot is skipped, '' without one. */
export function firstAllowedAbility(dex: GenDex, species: string, skip: (abilityId: string) => boolean): string {
  const slots = (dex.species.get(species).abilities ?? {}) as unknown as Record<string, string | undefined>;
  for (const slot of ['0', '1', 'H'] as const) {
    const ability = slots[slot];
    if (ability && !skip(toId(ability))) return ability;
  }
  return slots['0'] || '';
}

/** The ability the simulator plays: the species' own one the log's name maps to, else a battle-only forme's default. */
export function legalAbility(set: PokemonSet, context: LegalityContext): string {
  if (context.gen < 3 || !set.ability) return set.ability;
  const dex = dexOf(context);
  if (!dex.species.get(set.species).exists) return set.ability;
  const id = toId(set.ability);
  if (ownAbilities(dex, set.species).some(name => toId(name) === id)) return set.ability;
  // The sim plays an unknown ability id as none (pokemon.js:184 `toID(set.ability)`): "As One" is "As One (Spectrier)".
  if (!dex.abilities.get(set.ability).exists) return speciesAbilityFor(dex, set.species, set.ability) ?? set.ability;
  // An ability only a battle-only forme carries (Ogerpon before its Tera) becomes the default; Hackmons keeps it.
  if (!context.freeAbilities && battleOnlyAbilityIds(dex, set.species).has(id)) return slotZeroAbility(dex, set.species) ?? set.ability;
  return set.ability;
}

/** Outside free-ability formats, a species with a fixed Tera type or item (Ogerpon's masks, Terapagos) carries it. */
export function withRequiredFields(set: PokemonSet, context: LegalityContext): PokemonSet {
  // Without a fixed one the sim takes the species' first type as Tera type (pokemon.js:209 `set.teraType || types[0]`).
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
