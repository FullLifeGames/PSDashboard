import type { PokemonSet } from '@pkmn/sim';
import { toId } from '../ids.ts';

/**
 * Round 69 (T190, spec decision 8): the log names the forme a mon wears at the line (Golisopod-Mega, Aegislash-Blade,
 * Ogerpon-Wellspring-Tera), the team names the species it came from. The Dex says which species a forme comes from; no list
 * here. The solver reads the base set and prices on the forme's own stats and ability.
 */

/** What this module reads of a Dex: the species and item rows (the simulator's Dex and @pkmn/dex both fit). */
export interface FormeDex {
  species: { get(name: string): FormeRow };
  items: { get(name: string): { megaStone?: unknown } };
}

export interface FormeRow {
  exists: boolean;
  name: string;
  baseSpecies: string;
  battleOnly?: string | readonly string[];
  changesFrom?: string;
  isMega?: boolean;
  requiredItem?: string;
  requiredItems?: readonly string[];
  /** The ability slots (0, 1, H, S) by name. */
  abilities: object;
  baseStats: { readonly spe: number };
}

/** The species a Mega Stone turns into the forme, from the item's own table (the Mega-Z formes carry no `isMega`). */
function stoneOrigins(dex: FormeDex, forme: FormeRow): string[] {
  const stones = [forme.requiredItem, ...(forme.requiredItems ?? [])].filter((name): name is string => !!name);
  return stones.flatMap(stone => {
    const table = dex.items.get(stone).megaStone;
    if (!table || typeof table !== 'object') return [];
    return Object.entries(table as Record<string, string>).filter(([, mega]) => mega === forme.name).map(([base]) => base);
  });
}

/**
 * The species a battle forme comes from, read from the Dex: `battleOnly` (a name, or the several a team may carry),
 * `changesFrom`, the species a Mega Stone evolves into the forme, and a Mega's base species. Empty for a species a team
 * carries as it is and for a name the Dex does not know.
 */
export function formeOrigin(dex: FormeDex, species: string): string[] {
  return [...originsOf(dex, species, new Set())];
}

const madeInBattle = (dex: FormeDex, forme: FormeRow) => !!forme.battleOnly || !!forme.isMega || stoneOrigins(dex, forme).length > 0;

/** The origins of a forme, followed through the formes that are made in battle themselves (a Mega of Zygarde-Complete comes from Zygarde). */
function originsOf(dex: FormeDex, species: string, seen: Set<string>): Set<string> {
  const forme = dex.species.get(species);
  const carried = new Set<string>();
  if (!forme.exists || seen.has(forme.name)) return carried;
  const path = new Set(seen).add(forme.name);
  const names = [
    ...([] as string[]).concat(forme.battleOnly ?? []),
    ...(forme.changesFrom ? [forme.changesFrom] : []),
    ...stoneOrigins(dex, forme),
    ...(forme.isMega ? [forme.baseSpecies] : []),
  ];
  for (const name of names) {
    const origin = dex.species.get(name);
    if (!origin.exists || origin.name === forme.name) continue;
    // An origin made in battle itself leads on to the species a team carries; a species with `changesFrom` only (Zygarde-10%) is carried.
    const further = madeInBattle(dex, origin) ? originsOf(dex, origin.name, path) : new Set<string>();
    if (further.size === 0) carried.add(origin.name);
    else for (const base of further) carried.add(base);
  }
  return carried;
}

const named = (sets: readonly PokemonSet[], species: string) =>
  sets.some(set => toId(set.species) === toId(species) || toId(set.name || '') === toId(species));

/**
 * The species whose set a mon plays as: its own name when a set carries it, else the first species it comes from that a set
 * carries (the list of Zygarde-Complete or Necrozma-Ultra leaves the team to decide). Undefined when no set matches.
 */
export function originIn(dex: FormeDex, sets: readonly PokemonSet[], species: string): string | undefined {
  if (named(sets, species)) return undefined;
  return formeOrigin(dex, species).find(origin => named(sets, origin));
}

/**
 * The ability a forme fights with: the set's when the forme can have it (Aegislash-Blade keeps Stance Change), else the
 * forme's own first (a Mega's ability, Embody Aspect on a Tera mask). The set's ability for a mon that wears no forme.
 */
export function formeAbility(dex: FormeDex, forme: string | undefined, setAbility: string | undefined): string | undefined {
  if (!forme) return setAbility || undefined;
  const own = Object.values(dex.species.get(forme).abilities as Record<string, string | undefined>).filter((name): name is string => !!name);
  if (setAbility && own.some(name => toId(name) === toId(setAbility))) return setAbility;
  return own[0] ?? (setAbility || undefined);
}
