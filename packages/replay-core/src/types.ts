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
  /** Viewer perspective requested by the loaded link (the ?p2 replay-URL flag). */
  viewpoint?: 'p1' | 'p2';
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
  /**
   * Sleep turns @pkmn/client counted (one per |cant|..|slp| line), only while
   * the body sleeps; absent on snapshots written before round 69 (T187).
   */
  sleepTurns?: number;
  /** Index in the side's active row, only for an active body; absent on snapshots written before round 69 (T151). */
  slot?: number;
  /**
   * The stat Protosynthesis or Quark Drive raises, as @pkmn/client's volatile of that name keeps it
   * (`atk`, `def`, `spa`, `spd`, `spe`); absent without the boost and on snapshots written before round 69 (T158).
   */
  boostedStat?: string;
  /** Supreme Overlord's count of fallen allies, from the client's `fallenN` volatile; absent without it and before round 69 (T158). */
  fallen?: number;
  /**
   * The hits the body took, as @pkmn/client counts them (Rage Fist's count); absent at none and on snapshots written before
   * round 76 (T265).
   */
  timesAttacked?: number;
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
  /**
   * Remaining turns of the weather and the terrain as @pkmn/client counts
   * them (round 60, T92); absent on snapshots written before round 60.
   */
  weatherState?: { minDuration: number; maxDuration: number };
  terrainState?: { minDuration: number; maxDuration: number };
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
 * Crits, multi-hits (per target in doubles), hits boosted by Helping Hand,
 * and [from]-attributed damage are excluded at collection time. Doubles
 * give one observation per target of a move (round 69, T31).
 */
export interface DamageObservation {
  attackerSpecies: string;
  defenderSpecies: string;
  attackerSide: 'p1' | 'p2';
  moveId: string;
  /** Damage dealt as a fraction of the defender's max HP (HP-bar precision). */
  observedFraction: number;
  /**
   * The hit took the defender's remaining HP (|-damage|...|0 fnt): the
   * recorded fraction is a LOWER BOUND on the damage, not a reading.
   */
  lethal: boolean;
  attackerBoosts: Record<string, number>;
  defenderBoosts: Record<string, number>;
  attackerStatus: string;
  /** Screens up on the DEFENDER's side at the moment of the hit. */
  screens: string[];
  weather: string;
  /**
   * The battle was not singles (the `|gametype|` line decides, not the format
   * name): the calculator prices the hit on a Doubles field. Absent on
   * observations of caches older than round 69, which read as singles.
   */
  doubles?: boolean;
  /**
   * The move line named `[spread]`: the simulator cut the damage to 0.75, even
   * when only one target took it (the other protected). A spread move without
   * the mark hit its only target at full damage.
   */
  spread?: boolean;
  /** The side of the defender: the other side unless a spread move hit the attacker's partner. Absent reads as the other side. */
  defenderSide?: 'p1' | 'p2';
  /**
   * The item id the client battle shows each mon holding at the hit (round 69, T191): '' when it holds none or the log never
   * showed it. An item that ended inside the very move before its damage line (a weakening berry, a gem) still counts.
   * Absent on observations of caches older than T191, which read the set's item.
   */
  attackerItem?: string;
  defenderItem?: string;
  /** The item differs from the one the mon came in with (used up, knocked off, stolen, swapped): '' then means gone, not unseen. */
  attackerItemChanged?: boolean;
  defenderItemChanged?: boolean;
  /**
   * The stat an active Protosynthesis or Quark Drive raises and the stat stages the Pokémon had when the ability activated
   * (round 69, T167): the simulator picks the highest stat there. Absent when the ability is not active at the hit.
   */
  attackerParadox?: ParadoxReading;
  defenderParadox?: ParadoxReading;
  /**
   * The move's name as the `|move|` line prints it (round 69, T86): the calculator keys Weather Ball, Terrain Pulse, Techno Blast
   * and Multi-Attack on the name, not on the id. Absent on observations of caches older than T86, which read the id.
   */
  moveName?: string;
  /** The terrain id the client battle shows at the hit ('' none). */
  terrain?: string;
  /** The type each side Terastallized to, as the client names it; absent when it has not. */
  attackerTera?: string;
  defenderTera?: string;
  /** Each side's HP as a fraction of its maximum before the hit: Multiscale needs full HP, Eruption and Water Spout scale with it. */
  attackerHp?: number;
  defenderHp?: number;
  /** The fallen Supreme Overlord counted when the attacker came in (the `fallenN` start line of the ability); absent at none. */
  attackerFallen?: number;
  /**
   * The ability id the client shows each side with at the hit (revealed by the log, or changed by it: Trace, Skill Swap); absent
   * when the log never showed it. `Suppressed` is set when Gastro Acid, Neutralizing Gas or an ended ability took it away.
   */
  attackerAbility?: string;
  defenderAbility?: string;
  attackerSuppressed?: boolean;
  defenderSuppressed?: boolean;
  /** The attacker's ability is on, as its own volatile shows (Flash Fire after the absorbed hit, Slow Start, Unburden). */
  attackerAbilityOn?: boolean;
  /**
   * What the log shows besides the two Pokémon that the calculator reads off the field (ids, sorted): Helping Hand and Charge on
   * the attacker, an attacker's ally with Battery, Power Spot or Steely Spirit, a defender's ally with Friend Guard, a Ruin or Aura
   * ability on the field, Gravity, Magic Room, Wonder Room. Absent at none.
   */
  fieldFacts?: string[];
  /**
   * The living partner of each side at the hit, doubles only (round 73, T203): its species forme, the ability the client shows it
   * with (`ability`, empty when the ability is suppressed), and `unrevealed` when the log never showed the ability. The solver reads
   * the field abilities of a partner whose ability the log hid from the Dex (a species with one ability) or from its built set.
   */
  attackerAlly?: AllyReading;
  defenderAlly?: AllyReading;
  /**
   * The history a move's power can read (round 73, T210 group 1), only when above zero: the fainted members of the attacker's
   * side (Last Respects) and the hits the attacker took (Rage Fist), as the client battle holds them at the damage line.
   */
  attackerFainted?: number;
  attackerTimesAttacked?: number;
  /** The defender's status before the hit (round 73, T210 group 2): Hex and Venoshock double against it, Marvel Scale lifts Defense under it. */
  defenderStatus?: string;
  /**
   * The turn's order of events at the hit (round 73, T210 group 3), only when true: the defender switched in this turn (Stakeout), and
   * every other active Pokémon had moved (Analytic).
   */
  defenderNewlyIn?: boolean;
  lastToMove?: boolean;
}

export interface AllyReading {
  species: string;
  ability?: string;
  unrevealed?: boolean;
}

/** What the log shows of an active Protosynthesis or Quark Drive: the stat the client names and the stages the simulator read it at. */
export interface ParadoxReading {
  stat: StatId;
  stages: Record<string, number>;
}

/**
 * One typeless-Hidden-Power hit's effectiveness reading: the replay only
 * ever shows the generic "Hidden Power", so these markers are the type
 * evidence the builder filters candidates with (`neutral` = a damage line
 * with no effectiveness marker). Typed variants emit nothing.
 */
export interface HiddenPowerEvidence {
  attackerSide: 'p1' | 'p2';
  attackerSpecies: string;
  defenderSpecies: string;
  marker: 'super' | 'resisted' | 'immune' | 'neutral';
}

/**
 * Same-turn move order the log PROVED: `first` acted before `second` at equal
 * priority with no speed modifier in sight (no priority moves, paralysis,
 * Tailwind, Trick Room, speed stages, or same-turn switch-ins). The spread
 * solver treats it as a hard effective-speed constraint so branches reproduce
 * the order the replay showed (GPL: Noivern moved before Iron Valiant while
 * the guessed spread had it slower).
 */
export interface SpeedOrderObservation {
  firstSide: 'p1' | 'p2';
  firstSpecies: string;
  secondSide: 'p1' | 'p2';
  secondSpecies: string;
  turn: number;
  /**
   * The Choice Scarf each mover held that turn, for a mon whose Scarf came or
   * went during the game (round 63): the race is read with it instead of the
   * set's item.
   */
  firstScarf?: boolean;
  secondScarf?: boolean;
  /** The second mover fell before acting: its chosen move, and so its priority, never showed (round 63). */
  knockOut?: true;
  /**
   * The mover was transformed: it raced on this Pokémon's Speed with its own
   * item (round 64; the simulator's Transform copies the target's stats).
   */
  firstCopied?: { side: 'p1' | 'p2'; species: string };
  secondCopied?: { side: 'p1' | 'p2'; species: string };
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

/** One side of a logged hit, as it stood when the move landed. */
export interface HitParty {
  /** The forme that took part (a Mega, Terapagos-Terastal). */
  species: string;
  level: number;
  /** The Tera type when terastallized. */
  tera?: string;
  boosts: Record<string, number>;
  status: string;
  /** HP as a fraction of max HP before the hit. */
  hp: number;
  /** Known ability at the hit ('' when unknown). */
  ability: string;
  /** The item the log shows it holding at the hit ('' when none is shown). */
  held: string;
  /** It lost an item or took one from another Pokémon before the hit: its own set item is not what it held. */
  itemChanged: boolean;
  /** 'M', 'F' or '' (genderless or unknown): Rivalry reads it. */
  gender: string;
  /** Its side's fainted Pokémon at the hit (Supreme Overlord). */
  alliesFainted: number;
  /** Ability states the calculator cannot see by itself: an active Flash Fire, Slow Start, Protosynthesis or Quark Drive stat, a Charge. */
  flashFire: boolean;
  slowStart: boolean;
  boostedStat: string;
  charged: boolean;
}

/**
 * One clean hit a Pokémon dealt, as the log shows it (round 67, T130): what
 * the damage judge needs to recompute it with the calculator, in singles and
 * doubles. The inference collects it with its own @pkmn/client walk; crits,
 * multi-hit moves and [from]-attributed damage stay out.
 */
export interface LoggedHit {
  move: string;
  attacker: HitParty;
  defender: HitParty & { side: 'p1' | 'p2' };
  /** Damage as a fraction of the defender's max HP. */
  observed: number;
  /** The hit knocked the defender out or left it at the lowest HP the log shows: only a floor on the damage. */
  lowerBound: boolean;
  weather: string;
  terrain: string;
  /** Reflect, Light Screen and Aurora Veil on the defender's side. */
  screens: string[];
  helpingHand: boolean;
  /** The defender came in this turn (Stakeout). */
  defenderNew: boolean;
  doubles: boolean;
  /** The move line names its spread targets ([spread]): the calculator's spread factor applies. */
  spread: boolean;
  /** The other Pokémon on the field, with the ability the log showed ('' when unknown). */
  others: { species: string; ability: string }[];
  /** Anything the calculator cannot know: a transformed or stat-swapped party, Magic Room, Wonder Room, Dynamax. */
  doubt: string;
  gen: number;
  /** The format as the log's |tier| line names it. */
  format: string;
}

/**
 * A move of the set that the log proves without naming it (round 70, batch fix). A Z-move or a Max move shows the type of its
 * base move and never the base move. `attack` asks for a damaging move of `type`; `status` asks for any status move, the base of
 * Max Guard. The build fills the slot from the chosen published set, the move guesses and the usage list.
 */
export type OpenMove = { kind: 'attack'; type: string } | { kind: 'status' };

export interface RevealedPokemonInfo {
  species: string;
  moves: PokemonMoveInfo[];
  /** The base moves of Z-moves and Max moves the log hides (round 70); a move of `moves` that fits one fills it. */
  openMoves?: OpenMove[];
  /** The Pokémon Gigantamaxed (`-start` with Gmax, or a G-Max move): the simulator then plays its G-Max move (round 70). */
  gigantamax?: boolean;
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
   * The name the replay gave this body (round 72, T238): its first `switch`, `drag` or `replace` line, else an Open Team
   * Sheet's name field. Unset when the name is the species' own, or the species of another body of the side (a lookup by
   * name would then find the wrong body), or when the replay never named the body (team preview carries no nickname).
   */
  nickname?: string;
  /**
   * The shiny flag of the body's details in the same lines, or the sheet's. Unset when no line showed the body: team
   * preview strips the flag, so an unrevealed body reads as not shiny to the simulator, as the log would have it.
   */
  shiny?: boolean;
  /**
   * The log showed the body with no gender although its species has one (a fixed one included): the game ran it as genderless (a set that says
   * `N`). A set without a gender makes the simulator draw one, so the build says `N` for such a body (round 72, T238).
   */
  noGender?: boolean;
  /**
   * Values DISPROVEN by protocol evidence (toId'd) — hazard damage rules out
   * Magic Guard, rocks chip rules out Heavy-Duty Boots, a landed Ground move
   * rules out Levitate. Rule-outs beat guesses, never revealed/manual/sheet.
   */
  ruledOut?: { abilities: string[]; items: string[] };
  /** The clean hits this Pokémon dealt (round 67, T130): the damage judge reads them against its item candidates. */
  hits?: LoggedHit[];
}

export interface OpponentTeamInfo {
  pokemon: RevealedPokemonInfo[];
}
