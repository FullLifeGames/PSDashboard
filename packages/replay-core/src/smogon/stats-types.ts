export interface UsageProbability {
  value: string;
  probability: number;
  sourceDetail: string;
}

export interface UsageSpread extends UsageProbability {
  nature: string;
  evs: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
}

export interface PokemonUsageStats {
  species: string;
  rawCount: number;
  abilities: UsageProbability[];
  items: UsageProbability[];
  moves: UsageProbability[];
  spreads: UsageSpread[];
  /**
   * Round 88 (F, #101): the species that share a team with this one, most common first (`probability` is the share of this
   * species' teams that carry the teammate). Absent when the stats file lists none; the stand-in step reads it.
   */
  teammates?: UsageProbability[];
}

export interface SmogonUsageStats {
  format: string;
  month: string;
  source: string;
  pokemon: Record<string, PokemonUsageStats>;
}

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

export interface PkmnStatsPayload {
  pokemon?: Record<string, PkmnPokemonStats>;
}
