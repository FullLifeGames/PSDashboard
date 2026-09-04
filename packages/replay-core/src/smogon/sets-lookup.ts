/**
 * The published-set assumption model and its pure lookup: no network, no
 * cache. smogon-sets.ts fetches the sets and re-exports these names.
 */
import { toId } from '../ids.ts';

export interface SetAssumption {
  value: string;
  sourceDetail: string;
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
}

export function getSpeciesSetAssumption(
  assumptions: SmogonSetAssumptions | null | undefined,
  species: string,
): PokemonSetAssumption | undefined {
  if (!assumptions) return undefined;
  return assumptions.pokemon[toId(species)] ??
    Object.values(assumptions.pokemon).find(entry => toId(entry.species) === toId(species));
}
