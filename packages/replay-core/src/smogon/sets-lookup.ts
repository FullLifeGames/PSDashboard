import { toId } from '../ids.ts';

/** One published slot (ability, item or move): its value, where it came from and every option listed. */
export interface SetAssumption {
  value: string;
  sourceDetail: string;
  /** Every option of a published slot ("Leftovers / Metal Coat"), `value` first; absent on a fixed slot. */
  options?: string[];
}

/** A set assumption with the nature and EVs of a published spread. */
export interface SetSpreadAssumption extends SetAssumption {
  nature: string;
  evs: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
}

/** What the published sets assume for one species: ability, item, moves, spread and IVs. */
export interface PokemonSetAssumption {
  species: string;
  sourceDetail: string;
  ability?: SetAssumption;
  item?: SetAssumption;
  moves: SetAssumption[];
  spread?: SetSpreadAssumption;
  /** The IVs the set lists (Trick Room Speed 0); absent when it lists none (the build then plays 31). */
  ivs?: Partial<Record<'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe', number>>;
  /** The species' other published sets; this entry is the first. */
  alternatives?: PokemonSetAssumption[];
}

/** The published-set assumptions of one format, by species id. */
export interface SmogonSetAssumptions {
  format: string;
  source: string;
  pokemon: Record<string, PokemonSetAssumption>;
  /** Fetch failures, one "<species or random sets>: <message>" per entry; absent when none failed. */
  errors?: string[];
  /** Every set file that contributed, the format's own first, then the generation Ubers fallback. */
  formats?: string[];
}

/** The species' assumption by id, else by the entry's own species name; undefined when the sets hold none. */
export function getSpeciesSetAssumption(
  assumptions: SmogonSetAssumptions | null | undefined,
  species: string,
): PokemonSetAssumption | undefined {
  if (!assumptions) return undefined;
  return assumptions.pokemon[toId(species)] ??
    Object.values(assumptions.pokemon).find(entry => toId(entry.species) === toId(species));
}
