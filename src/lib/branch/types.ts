import type { BattleStreams } from '@pkmn/sim';
import type { BranchSlotChoice } from '../branch-choices';
import type { TurnAlignmentRecord } from '../hax-alignment';

export type SimBattle = NonNullable<BattleStreams.BattleStream['battle']>;
export type SimSide = SimBattle['sides'][number];
export type SimPokemon = SimSide['pokemon'][number];

export interface PokemonStatTable {
  hp: number;
  atk: number;
  def: number;
  spa: number;
  spd: number;
  spe: number;
}

export interface BranchMoveOption {
  name: string;
  activeSlot: number;
  slot: number;
  pp: number;
  maxpp: number;
  disabled: boolean;
  type: string;
  targetType: string;
  requiresTarget: boolean;
  targetOptions: BranchTargetOption[];
}

export interface BranchTargetOption {
  label: string;
  targetLoc: number;
  side: 'p1' | 'p2';
  activeSlot: number;
  name: string;
  species: string;
  hpPercent: number;
}

export interface BranchSwitchOption {
  name: string;
  species: string;
  activeSlot: number;
  slot: number;
  hp: string;
  hpPercent: number;
  fainted: boolean;
}

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
  boosts: Record<string, number>;
  level: number;
  types: string[];
}

export interface BranchFieldState {
  weather: string;
  terrain: string;
  p1SideConditions: string[];
  p2SideConditions: string[];
}

/** Per-active-slot availability of battle gimmicks (Tera/Mega/Z/Ultra, G7). */
export interface BranchSlotModifiers {
  teraType: string | null;
  canMegaEvo: boolean;
  canUltraBurst: boolean;
  /** Z-move name per move slot (index 0 = move slot 1), null when the move has no Z option. */
  zMoves: (string | null)[];
}

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

export interface BranchRuntime {
  battleStream: BattleStreams.BattleStream;
  streams: ReturnType<typeof BattleStreams.getPlayerStreams>;
  log: string[];
  choiceErrors: BranchChoiceErrorLog;
  /** True when the overall reconstruction deadline was hit before the target turn (B17). */
  timedOut: boolean;
  /** Per-block hax alignment: chosen seed + the truly emitted block's score. */
  haxAlignment: TurnAlignmentRecord[];
}

/**
 * Choice rejections arrive as `|error|` sideupdates on the per-player streams,
 * never on the omniscient stream — this collects them so executes can fail loudly.
 */
export interface BranchChoiceErrorLog {
  count: number;
  last: string | null;
}

export type BranchExecuteResult =
  | { ok: true }
  | { ok: false; error: string };

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
