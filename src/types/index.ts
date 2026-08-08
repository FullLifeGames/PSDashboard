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

/**
 * One clean, direct damaging hit observed in the protocol, with the context
 * needed to recompute it with a damage calculator: spread inference scores
 * candidate EV spreads by how well their roll ranges reproduce these.
 * Crits, multi-hits, spread moves (doubles), and [from]-attributed damage
 * are excluded at collection time.
 */
export interface DamageObservation {
  attackerSpecies: string;
  defenderSpecies: string;
  attackerSide: 'p1' | 'p2';
  moveId: string;
  /** Damage dealt as a fraction of the defender's max HP (HP-bar precision). */
  observedFraction: number;
  attackerBoosts: Record<string, number>;
  defenderBoosts: Record<string, number>;
  attackerStatus: string;
  /** Screens up on the DEFENDER's side at the moment of the hit. */
  screens: string[];
  weather: string;
}

export type KnowledgeSource = 'revealed' | 'guessed' | 'manual' | 'sheet' | 'unknown';
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
  /**
   * Values DISPROVEN by protocol evidence (toId'd) — hazard damage rules out
   * Magic Guard, rocks chip rules out Heavy-Duty Boots, a landed Ground move
   * rules out Levitate. Rule-outs beat guesses, never revealed/manual/sheet.
   */
  ruledOut?: { abilities: string[]; items: string[] };
}

export interface OpponentTeamInfo {
  pokemon: RevealedPokemonInfo[];
}
