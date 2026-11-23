import type { BattleStreams } from '@pkmn/sim';
import type { BranchSlotChoice } from '../branch-choices.ts';
import type { TurnAlignmentRecord } from '../hax-alignment.ts';
import type { DiceReport } from '../dice/types.ts';

export type SimBattle = NonNullable<BattleStreams.BattleStream['battle']>;
export type SimSide = SimBattle['sides'][number];
export type SimPokemon = SimSide['pokemon'][number];

/** The six stats, HP included (EVs, IVs). */
export interface PokemonStatTable {
  hp: number;
  atk: number;
  def: number;
  spa: number;
  spd: number;
  spe: number;
}

/** One move button of the picker: the slot, PP, type, target type and the aims it offers. */
export interface BranchMoveOption {
  name: string;
  activeSlot: number;
  slot: number;
  pp: number;
  maxpp: number;
  disabled: boolean;
  type: string;
  /** The type after the Tera click, only when it differs from `type` (Tera Blast, Tera Starstorm). */
  typeUnderTera?: string;
  targetType: string;
  requiresTarget: boolean;
  targetOptions: BranchTargetOption[];
}

/** One aim of a doubles move: the body at the loc, with its HP percent. */
export interface BranchTargetOption {
  label: string;
  targetLoc: number;
  side: 'p1' | 'p2';
  activeSlot: number;
  name: string;
  species: string;
  hpPercent: number;
}

/** One switch chip of the picker: a bench body with its HP and the party slot to switch to. */
export interface BranchSwitchOption {
  name: string;
  species: string;
  activeSlot: number;
  slot: number;
  hp: string;
  hpPercent: number;
  fainted: boolean;
  /** The slot's Pokémon is held: the simulator refuses any switch from it this turn. Absent on a forced replacement. */
  trapped?: boolean;
}

/** The calc's reading of a simulator body: stats, set, status, boosts and the volatile facts the damage formulas use. */
export interface SimPokemonInfo {
  name: string;
  species: string;
  hp: number;
  maxhp: number;
  hpPercent: number;
  status: string;
  fainted: boolean;
  isActive: boolean;
  activeSlot: number | null;
  moves: { name: string; type: string }[];
  ability: string;
  item: string;
  stats: { atk: number; def: number; spa: number; spd: number; spe: number };
  nature?: string;
  evs?: PokemonStatTable;
  ivs?: PokemonStatTable;
  gender?: string;
  teraType?: string;
  /** Types a Stellar Pokémon has already spent its one-time boost on (the sim's stellarBoostedTypes). */
  stellarBoostedTypes?: string[];
  /** The stat Protosynthesis or Quark Drive raises, as the simulator's volatile names it. */
  boostedStat?: string;
  /** Supreme Overlord's count of fallen allies, as its ability state keeps it. */
  alliesFainted?: number;
  /** The side's fallen so far (side.totalFainted), the count Last Respects powers up by. */
  totalFainted?: number;
  /** The hits the body took (timesAttacked), the count Rage Fist powers up by. */
  timesAttacked?: number;
  hpType?: string;
  hpPower?: number;
  /** 'champions' on a body of a Champions battle: its evs hold Stat Points, which the calc reads as EVs. */
  mod?: string;
  /** A Tatsugiri inside its Dondozo (the simulator's `commanding` volatile); the simulator passes its slot. */
  commanding?: boolean;
  boosts: Record<string, number>;
  level: number;
  types: string[];
}

/** The weather, terrain and side conditions of a position. */
export interface BranchFieldState {
  weather: string;
  terrain: string;
  p1SideConditions: string[];
  p2SideConditions: string[];
}

/** Per-active-slot availability of battle gimmicks (Tera, Mega, Z, Ultra Burst). */
export interface BranchSlotModifiers {
  teraType: string | null;
  canMegaEvo: boolean;
  canUltraBurst: boolean;
  /** Z-move name per move slot (index 0 = move slot 1), null when the move has no Z option. */
  zMoves: (string | null)[];
}

/** What the pickers read off a position: moves, switches, bodies, field, force-switch flags and the pending choices per side. */
export interface BranchSimState {
  p1Moves: BranchMoveOption[];
  p1MovesBySlot: BranchMoveOption[][];
  p1Switches: BranchSwitchOption[];
  p1SwitchesBySlot: BranchSwitchOption[][];
  p2Moves: BranchMoveOption[];
  p2MovesBySlot: BranchMoveOption[][];
  p2Switches: BranchSwitchOption[];
  p2SwitchesBySlot: BranchSwitchOption[][];
  p1Pokemon: SimPokemonInfo[];
  p2Pokemon: SimPokemonInfo[];
  p1Active: SimPokemonInfo | null;
  p1ActiveSlots: (SimPokemonInfo | null)[];
  p2Active: SimPokemonInfo | null;
  p2ActiveSlots: (SimPokemonInfo | null)[];
  p1ModifiersBySlot: BranchSlotModifiers[];
  p2ModifiersBySlot: BranchSlotModifiers[];
  field: BranchFieldState;
  log: string[];
  ended: boolean;
  winner: string | null;
  waitingForChoice: boolean;
  turnNumber: number;
  p1ForceSwitch: boolean;
  p1ForceSwitches: boolean[];
  p2ForceSwitch: boolean;
  p2ForceSwitches: boolean[];
  p1Choice: BranchSlotChoice | null;
  p1Choices: (BranchSlotChoice | null)[];
  p2Choice: BranchSlotChoice | null;
  p2Choices: (BranchSlotChoice | null)[];
}

/** A rebuilt battle with its streams, log, choice errors and the per-block hax alignment. */
export interface BranchRuntime {
  battleStream: BattleStreams.BattleStream;
  streams: ReturnType<typeof BattleStreams.getPlayerStreams>;
  log: string[];
  choiceErrors: BranchChoiceErrorLog;
  /** True when the overall reconstruction deadline was hit before the target turn. */
  timedOut: boolean;
  /** Per-block hax alignment: chosen seed + the truly emitted block's score. */
  haxAlignment: TurnAlignmentRecord[];
}

/** The count and last text of choice rejections, which arrive as `|error|` sideupdates on the per-player streams, never on the omniscient one. */
export interface BranchChoiceErrorLog {
  count: number;
  last: string | null;
}

/** The result of an execute; `dice` reports what the simulator did with the dice the user forced, for a turn that carried one. */
export type BranchExecuteResult =
  | { ok: true; dice?: DiceReport }
  | { ok: false; error: string };

/** The pending choice per side, by slot (`p1Choice` is the first slot of `p1Choices`). */
export interface BranchChoices {
  p1Choice?: BranchSlotChoice | null;
  p2Choice?: BranchSlotChoice | null;
  p1Choices?: (BranchSlotChoice | null)[];
  p2Choices?: (BranchSlotChoice | null)[];
}

export interface TurnBlock {
  turn: number;
  preUpkeep: string[];
  postUpkeep: string[];
}

export interface PokemonIdent {
  name: string;
  species: string;
}
