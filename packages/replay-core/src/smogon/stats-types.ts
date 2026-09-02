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
}

export interface PkmnStatsPayload {
  pokemon?: Record<string, PkmnPokemonStats>;
}
