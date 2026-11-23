/** One usage entry: a value, its probability and the source label. */
export interface UsageProbability {
  value: string;
  probability: number;
  sourceDetail: string;
}

/** A usage entry for a spread: nature and EVs. */
export interface UsageSpread extends UsageProbability {
  nature: string;
  evs: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
}

/** The usage statistics of one species. */
export interface PokemonUsageStats {
  species: string;
  rawCount: number;
  abilities: UsageProbability[];
  items: UsageProbability[];
  moves: UsageProbability[];
  spreads: UsageSpread[];
  /** The species that share a team with this one, most common first (`probability`: the share of this species' teams that carry it); absent when none. */
  teammates?: UsageProbability[];
}

/** The usage statistics of one format and month, by species id. */
export interface SmogonUsageStats {
  format: string;
  month: string;
  source: string;
  pokemon: Record<string, PokemonUsageStats>;
}

/** The top usage pick per slot for one species, with the source label. */
export interface SpeciesUsageSet {
  ability?: UsageProbability;
  item?: UsageProbability;
  moves: UsageProbability[];
  spread?: UsageSpread;
  sourceDetail: string;
}

interface ChaosPokemonStats {
  'Raw count'?: number;
  Abilities?: Record<string, number | string>;
  Items?: Record<string, number | string>;
  Moves?: Record<string, number | string>;
  Spreads?: Record<string, number | string>;
  Teammates?: Record<string, number | string>;
}

/** The payload of a Smogon chaos stats file. */
export interface ChaosStatsPayload {
  data?: Record<string, ChaosPokemonStats>;
}

interface PkmnPokemonStats {
  count?: number | string;
  abilities?: Record<string, number | string>;
  items?: Record<string, number | string>;
  moves?: Record<string, number | string>;
  spreads?: Record<string, number | string>;
  teammates?: Record<string, number | string>;
}

/** The payload of a pkmn stats file. */
export interface PkmnStatsPayload {
  pokemon?: Record<string, PkmnPokemonStats>;
}
