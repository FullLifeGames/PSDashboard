import type { HpText } from './hp-display.ts';

/** A loaded replay: its metadata, the protocol `log` and the optional `inputlog`. */
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

/** One Pokemon in a turn snapshot, as @pkmn/client holds it. */
export interface PokemonSnapshot {
  name: string;
  speciesForme: string;
  /** The species the body entered with, only while it wears a Transform copy (`speciesForme` is the copy). */
  baseSpeciesForme?: string;
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
  /** Sleep turns @pkmn/client counted (one per |cant|..|slp| line), only while the body sleeps. */
  sleepTurns?: number;
  /** Index in the side's active row, only for an active body. */
  slot?: number;
  /** The stat Protosynthesis or Quark Drive raises, as @pkmn/client's volatile keeps it; absent without the boost. */
  boostedStat?: string;
  /** Supreme Overlord's count of fallen allies, from the client's `fallenN` volatile; absent without it. */
  fallen?: number;
  /** The hits the body took, as @pkmn/client counts them (Rage Fist); absent at none. */
  timesAttacked?: number;
  /**
   * The PP the log shows spent, by move name, as @pkmn/client counts it (Pressure's extra point included, a Leppa or
   * Mystery Berry restore taken off); a pair is the range while Pressure is open. Own moves only, no Transform copy's.
   */
  ppUsed?: Record<string, number | [number, number]>;
}

/** One side of a turn snapshot: its name, its Pokemon and its side conditions. */
export interface SideSnapshot {
  name: string;
  id: 'p1' | 'p2';
  pokemon: PokemonSnapshot[];
  sideConditions: Record<string, unknown>;
}

/** The field of a turn snapshot: weather, terrain and pseudo-weather. */
export interface FieldSnapshot {
  weather: string;
  terrain: string;
  pseudoWeather: Record<string, unknown>;
  /** Remaining turns of the weather and the terrain as @pkmn/client counts them. */
  weatherState?: { minDuration: number; maxDuration: number };
  terrainState?: { minDuration: number; maxDuration: number };
}

/** The state at the start of a turn: both sides, the field, and the log lines played since the previous snapshot. */
export interface TurnSnapshot {
  turn: number;
  p1: SideSnapshot;
  p2: SideSnapshot;
  field: FieldSnapshot;
  log: string[];
}

/** One clean damaging hit from the protocol with its context; no crits, multi-hits, Helping Hand, [from] damage. */
export interface DamageObservation {
  // Doubles give one observation per target of a move.
  attackerSpecies: string;
  defenderSpecies: string;
  attackerSide: 'p1' | 'p2';
  moveId: string;
  /** Damage dealt as a fraction of the defender's max HP (HP-bar precision). */
  observedFraction: number;
  /** The hit took the defender's remaining HP (|-damage|...|0 fnt): the fraction is a LOWER BOUND on the damage. */
  lethal: boolean;
  attackerBoosts: Record<string, number>;
  defenderBoosts: Record<string, number>;
  attackerStatus: string;
  /** Screens up on the DEFENDER's side at the moment of the hit. */
  screens: string[];
  weather: string;
  /** The battle was not singles (`|gametype|` decides, not the format name): the calculator prices a Doubles field. */
  doubles?: boolean;
  /**
   * The move line named `[spread]`: the simulator cut the damage to 0.75, even when only one target took it (the other
   * protected). A spread move without the mark hit its only target at full damage.
   */
  spread?: boolean;
  /** The defender's side: the other one unless a spread move hit the attacker's partner; absent reads as the other. */
  defenderSide?: 'p1' | 'p2';
  /**
   * The item id the client shows each mon holding at the hit: '' when none or never shown. An item that ended inside
   * the very move before its damage line (a weakening berry, a gem) still counts.
   */
  attackerItem?: string;
  defenderItem?: string;
  /** The item differs from the one the mon came in with (used up, knocked off, stolen, swapped): '' then means gone. */
  attackerItemChanged?: boolean;
  defenderItemChanged?: boolean;
  /** The stat an active Protosynthesis or Quark Drive raises and the stages at activation; absent when inactive. */
  attackerParadox?: ParadoxReading;
  defenderParadox?: ParadoxReading;
  /** The move's name as the `|move|` line prints it: Weather Ball, Terrain Pulse, Techno Blast key on it. */
  moveName?: string;
  /** The terrain id the client shows at the hit ('' none). */
  terrain?: string;
  attackerTera?: string;
  defenderTera?: string;
  /**
   * The HP texts the log showed for the defender of a knockout (`lethal`): before the hit and, when it survived
   * (Sturdy, Focus Sash: `survivedAtOne`), after it (`hp-display.ts`). Absent on a hit that did not knock out.
   */
  defenderShown?: { before: HpText; after?: HpText };
  /** Each side's HP as a fraction of its maximum before the hit (Multiscale, Eruption and Water Spout read it). */
  attackerHp?: number;
  defenderHp?: number;
  /** The fallen Supreme Overlord counted when the attacker came in (the `fallenN` start line); absent at none. */
  attackerFallen?: number;
  /**
   * The ability the client shows each side with at the hit (revealed or changed: Trace, Skill Swap); absent if unseen.
   * `attackerSuppressed`, `defenderSuppressed`: Gastro Acid, Neutralizing Gas or an ended ability took it away.
   */
  attackerAbility?: string;
  defenderAbility?: string;
  attackerSuppressed?: boolean;
  defenderSuppressed?: boolean;
  /** The attacker's ability is on, as its own volatile shows (Flash Fire, Slow Start, Unburden). */
  attackerAbilityOn?: boolean;
  /**
   * What the calculator reads off the field besides the two Pokémon (ids, sorted): Helping Hand, Charge, an ally with
   * Battery, Power Spot, Steely Spirit or Friend Guard, a Ruin or Aura ability, Gravity, Magic Room, Wonder Room.
   */
  fieldFacts?: string[];
  /**
   * The living partner of each side at the hit, doubles only: its species forme, the ability the client shows it with
   * (`ability`, empty when suppressed), and `unrevealed` when the log never showed the ability.
   */
  attackerAlly?: AllyReading;
  defenderAlly?: AllyReading;
  /** A move power's history, only when above zero: the side's fainted (Last Respects), hits taken (Rage Fist). */
  attackerFainted?: number;
  attackerTimesAttacked?: number;
  /** The defender's status before the hit (Hex and Venoshock double against it, Marvel Scale lifts Defense). */
  defenderStatus?: string;
  /** Only when true: the defender switched in this turn (Stakeout); `lastToMove`: all others had moved (Analytic). */
  defenderNewlyIn?: boolean;
  lastToMove?: boolean;
}

export interface AllyReading {
  species: string;
  ability?: string;
  unrevealed?: boolean;
}

export interface ParadoxReading {
  stat: StatId;
  stages: Record<string, number>;
}

/** The effectiveness reading of one typeless "Hidden Power" hit (`neutral`: no marker), the builder's type evidence. */
export interface HiddenPowerEvidence {
  attackerSide: 'p1' | 'p2';
  attackerSpecies: string;
  defenderSpecies: string;
  marker: 'super' | 'resisted' | 'immune' | 'neutral';
}

/** The Speed effects one mover stood under, as ids a twin battle of the simulator replays. */
export interface RaceSpeedEffects {
  /** The Speed stage above 0 (absent at 0 and in Generation 1). */
  stage?: number;
  volatile?: string;
  sideConditions?: string[];
}

/** A same-turn move order the log PROVED (`first` before `second` at equal priority): a hard speed constraint. */
export interface SpeedOrderObservation {
  // Kept only when no priority, Quick Claw, possible speed ability, same-turn switch-in, Trick Room or lowerer holds.
  firstSide: 'p1' | 'p2';
  firstSpecies: string;
  secondSide: 'p1' | 'p2';
  secondSpecies: string;
  turn: number;
  /** The Choice Scarf each mover held that turn, for a mon whose Scarf came or went: the race uses it. */
  firstScarf?: boolean;
  secondScarf?: boolean;
  /** The second mover fell before acting: its chosen move, and so its priority, never showed. */
  knockOut?: true;
  /** The mover was transformed: it raced on this Pokémon's Speed with its own item (Transform copies stats). */
  firstCopied?: { side: 'p1' | 'p2'; species: string };
  secondCopied?: { side: 'p1' | 'p2'; species: string };
  /** The mover's effects at the turn's start and at the first mover's action (one entry if equal); absent if none. */
  firstSpeed?: RaceSpeedEffects[];
  secondSpeed?: RaceSpeedEffects[];
}

/** Where a field's value comes from: the protocol, a guess, the user, an open team sheet, or nowhere. */
export type KnowledgeSource = 'revealed' | 'guessed' | 'manual' | 'sheet' | 'unknown';
/** The six stat ids of a spread. */
export type StatId = 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe';
/** One number per stat: EVs, or IVs where a field says so. */
export type PokemonEvs = Record<StatId, number>;

/** A move of a Pokemon with its knowledge source, the probability of a guess and the panel's provenance label. */
export interface PokemonMoveInfo {
  name: string;
  source: Exclude<KnowledgeSource, 'unknown'>;
  probability?: number;
  sourceDetail?: string;
  detail?: string;
}

/** A text field (ability, item, tera type, nature) with its knowledge source and provenance label. */
export interface PokemonFieldInfo {
  value: string;
  source: KnowledgeSource;
  probability?: number;
  sourceDetail?: string;
  detail?: string;
}

/** An EVs or IVs field with its knowledge source and provenance label. */
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
  /** Supreme Overlord's count of fallen allies at the hit (the calculator's `alliesFainted`). */
  alliesFainted: number;
  /** Ability states the calculator cannot see: Flash Fire, Slow Start, Protosynthesis or Quark Drive stat, a Charge. */
  flashFire: boolean;
  slowStart: boolean;
  boostedStat: string;
  charged: boolean;
}

/** One clean hit a Pokémon dealt, as the log shows it: what the damage judge needs to recompute it. */
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

/** A set move the log proves without naming it: an attack of `type` (Z or Max move) or a status move (Max Guard). */
export type OpenMove = { kind: 'attack'; type: string } | { kind: 'status' };

/** What the app knows of one Pokemon of a side, each field with its knowledge source. */
export interface RevealedPokemonInfo {
  species: string;
  moves: PokemonMoveInfo[];
  /** The base moves of Z-moves and Max moves the log hides; a move of `moves` that fits one fills it. */
  openMoves?: OpenMove[];
  /** The Pokémon Gigantamaxed (`-start` with Gmax, or a G-Max move): the simulator then plays its G-Max move. */
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
   * The name the replay gave this body (first `switch`, `drag` or `replace` line, else an Open Team Sheet's). Unset if
   * it is the species' own or another body's (a lookup by name would find the wrong one), or never given.
   */
  nickname?: string;
  /** The shiny flag of the body's details lines or the sheet; unset when no line showed it (team preview strips it). */
  shiny?: boolean;
  /**
   * The log showed the body with no gender although its species has one: the game ran it as genderless (set `N`).
   * A set without a gender makes the simulator draw one, so the build says `N` for such a body.
   */
  noGender?: boolean;
  /** Values DISPROVEN by protocol evidence (toId'd); rule-outs beat guesses, never revealed, manual or sheet values. */
  ruledOut?: { abilities: string[]; items: string[] };
  hits?: LoggedHit[];
  /**
   * A body the log never showed, guessed from the format's teammate statistics because `|teamsize|` says the side has
   * more bodies (no team preview). The panel marks it "not revealed"; an edit drops the flag.
   */
  standIn?: true;
}

/** The team info of one side: its Pokemon, each with its knowledge sources. */
export interface OpponentTeamInfo {
  pokemon: RevealedPokemonInfo[];
}
