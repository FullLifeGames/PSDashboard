/**
 * The published-set assumption model and its pure lookup: no network, no
 * cache. smogon-sets.ts fetches the sets and re-exports these names.
 */
import { toId } from '../ids.ts';

export interface SetAssumption {
  value: string;
  sourceDetail: string;
  /**
   * Every option of a published slot, `value` first; absent on a fixed slot:
   * a move slot ("Heat Wave / Hidden Power Ice", round 63, T89) or the item
   * ("Leftovers / Metal Coat", round 64, T120).
   */
  options?: string[];
}

export interface SetSpreadAssumption extends SetAssumption {
  nature: string;
  evs: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
}

export interface PokemonSetAssumption {
  species: string;
  sourceDetail: string;
  ability?: SetAssumption;
  item?: SetAssumption;
  moves: SetAssumption[];
  spread?: SetSpreadAssumption;
  /**
   * The IVs the set lists (Trick Room Speed 0, Attack 0 on a special
   * attacker); absent when it lists none, and the build then plays 31
   * (round 64, T122). A list of IV options gives its first.
   */
  ivs?: Partial<Record<'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe', number>>;
  /**
   * The species' OTHER published sets (this entry is the first). Coherent-set
   * selection scores all of them against revealed evidence — curated sets are
   * internally coherent by construction, unlike marginal assembly.
   */
  alternatives?: PokemonSetAssumption[];
}

export interface SmogonSetAssumptions {
  format: string;
  source: string;
  pokemon: Record<string, PokemonSetAssumption>;
  /** Per-species fetch failures ("Toxapex: Failed to fetch"); absent when every species resolved or was merely absent. */
  errors?: string[];
  /** Every set file that contributed, the format's own first, then the generation Ubers fallback. */
  formats?: string[];
}

export function getSpeciesSetAssumption(
  assumptions: SmogonSetAssumptions | null | undefined,
  species: string,
): PokemonSetAssumption | undefined {
  if (!assumptions) return undefined;
  return assumptions.pokemon[toId(species)] ??
    Object.values(assumptions.pokemon).find(entry => toId(entry.species) === toId(species));
}
