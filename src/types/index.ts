export interface ReplayData {
  id: string;
  format: string;
  formatid: string;
  players: string[];
  log: string;
  inputlog?: string;
  uploadtime: number;
  views: number;
  rating?: number;
}

export interface PokemonSnapshot {
  name: string;
  speciesForme: string;
  hp: number;
  maxhp: number;
  hpPercent: number;
  status: string;
  fainted: boolean;
  isActive: boolean;
  boosts: Record<string, number>;
  moves: string[];
  ability: string;
  item: string;
  terastallized: string;
  level: number;
  gender: string;
}

export interface SideSnapshot {
  name: string;
  id: 'p1' | 'p2';
  pokemon: PokemonSnapshot[];
  sideConditions: Record<string, unknown>;
}

export interface FieldSnapshot {
  weather: string;
  terrain: string;
  pseudoWeather: Record<string, unknown>;
}

export interface TurnSnapshot {
  turn: number;
  p1: SideSnapshot;
  p2: SideSnapshot;
  field: FieldSnapshot;
  log: string[];
}

export type KnowledgeSource = 'revealed' | 'guessed' | 'manual' | 'unknown';
export type StatId = 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe';
export type PokemonEvs = Record<StatId, number>;

export interface PokemonMoveInfo {
  name: string;
  source: Exclude<KnowledgeSource, 'unknown'>;
  probability?: number;
  sourceDetail?: string;
  detail?: string;
}

export interface PokemonFieldInfo {
  value: string;
  source: KnowledgeSource;
  probability?: number;
  sourceDetail?: string;
  detail?: string;
}

export interface PokemonEvsInfo {
  value: PokemonEvs;
  source: KnowledgeSource;
  probability?: number;
  sourceDetail?: string;
  detail?: string;
}

export interface RevealedPokemonInfo {
  species: string;
  moves: PokemonMoveInfo[];
  ability: PokemonFieldInfo;
  item: PokemonFieldInfo;
  teraType: PokemonFieldInfo;
  evs: PokemonEvsInfo;
  nature?: PokemonFieldInfo;
  /** IV values 0–31; import/export passthrough, no editor UI. */
  ivs?: PokemonEvsInfo;
  level: number;
  gender: string;
}

export interface OpponentTeamInfo {
  pokemon: RevealedPokemonInfo[];
}
