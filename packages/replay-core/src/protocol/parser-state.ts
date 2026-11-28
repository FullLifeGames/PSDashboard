import { Battle, Pokemon } from '@pkmn/client';
import type { GenerationNum } from '@pkmn/data';
import { generationsFor } from '../format-generations.ts';
import { toId } from '../ids.ts';
import type { ItemReading } from './item-reading.ts';
import { raceEffects, type SpeedPoint } from './speed-effects.ts';
import type { DamageObservation, HiddenPowerEvidence, PokemonSnapshot, SpeedOrderObservation, TurnSnapshot } from '../types.ts';

export type ClientIdent = Parameters<Battle['getPokemon']>[0];

interface TurnMover {
  side: 'p1' | 'p2';
  species: string;
  ident: string;
  mon: Pokemon | undefined;
  seen: SpeedPoint;
  cleanFirst: boolean;
  cleanSecond: boolean;
}

export interface ScarfChange {
  turn: number;
  held: boolean;
}

export interface TargetHit {
  count: number;
  observation: DamageObservation | null;
}

export interface PendingMove {
  attacker: string;
  target: string;
  moveId: string;
  moveName: string;
  /** The move line names `[spread]`: the simulator cut the damage. */
  spread: boolean;
  crits: Set<string>;
  hits: Map<string, TargetHit>;
  itemsBefore: Map<string, ItemReading>;
  /** Targets with an item or ability line before their damage line: a Focus Sash, Sturdy or Endure may hold the hit. */
  marked: Set<string>;
  speedClean: boolean;
  seen: SpeedPoint;
  attackerSide: 'p1' | 'p2';
  attackerSpecies: string;
  effectiveness?: 'super' | 'resisted';
}

export interface ParserState {
  battle: Battle;
  snapshots: TurnSnapshot[];
  observations: DamageObservation[];
  speedOrders: SpeedOrderObservation[];
  hpEvidence: HiddenPowerEvidence[];
  currentTurnLines: string[];
  singles: boolean;
  genNum: GenerationNum;
  speedTurn: number;
  turnStart: SpeedPoint;
  turnMovers: TurnMover[];
  switchedThisTurn: Set<string>;
  actedThisTurn: Set<string>;
  reordered: Set<string>;
  quickActed: Set<string>;
  /** Per `side:species`, the turns a Choice Scarf came or went; the races of a change turn are dropped. */
  scarfChanges: Map<string, ScarfChange[]>;
  paradoxStages: Map<Pokemon, Record<string, number>>;
  /** Whose ability a `|-endability|` line took away (Gastro Acid): the client keeps no trace of it. */
  abilityEnded: Set<Pokemon>;
  lastMove: PendingMove | null;
  capturedInitial: boolean;
}

/** A fresh scan state; `format` is the log's tier, which picks the Generations of the client battle. */
export function createParserState(format = ''): ParserState {
  return {
    battle: new Battle(generationsFor(format)),
    snapshots: [],
    observations: [],
    speedOrders: [],
    hpEvidence: [],
    currentTurnLines: [],
    singles: true,
    genNum: 9,
    speedTurn: 0,
    turnStart: new Map(),
    turnMovers: [],
    switchedThisTurn: new Set<string>(),
    actedThisTurn: new Set<string>(),
    reordered: new Set<string>(),
    quickActed: new Set<string>(),
    scarfChanges: new Map<string, ScarfChange[]>(),
    paradoxStages: new Map<Pokemon, Record<string, number>>(),
    abilityEnded: new Set<Pokemon>(),
    lastMove: null,
    capturedInitial: false,
  };
}

// @pkmn/client 0.7.4 never charges Pressure's extra PP point: `getPressurePP` compares an ID with the name `Pressure`.
// eslint-disable-next-line names/no-new-dex-name -- the client's own ability ID, held to the simulator by the Pressure rows of low-pp-sweep.spec.ts
const PRESSURE = 'pressure';
type PressurePP = number | [number, number];
(Pokemon.prototype as unknown as { getPressurePP(pp: PressurePP, foes: Pokemon[]): PressurePP }).getPressurePP = function (this: Pokemon, pp, foes) {
  for (const foe of foes) {
    const abilities = Object.values(this.side.battle.gen.species.get(foe.speciesForme)?.abilities ?? {}).map(toId);
    // The game's generation is the client Dex's own number, never the calculator's (`calc-generation.spec.ts`).
    const canHavePressure = this.side.battle.gen.dex.gen === 3 &&abilities.includes(PRESSURE);
    if (toId(foe.effectiveAbility()) === PRESSURE || (canHavePressure && abilities.length === 1)) {
      if (typeof pp === 'number') pp += 1;
      else { pp[0] += 1; pp[1] += 1; }
    } else if (canHavePressure) {
      if (typeof pp === 'number') pp = [pp, pp];
      pp[0] += 1;
    }
  }
  return pp;
};

/** PP spent per move as @pkmn/client counts it; a pair is a range (the foe's Pressure is open, or a charge move). */
export function ppUsedOf(mon: Pokemon): PokemonSnapshot['ppUsed'] {
  const own = mon.moveSlots.filter(slot => !slot.virtual);
  if (own.length === 0) return undefined;
  // Grudge empties a move: the client counts Infinity, which a JSON snapshot would turn into null.
  const finite = (points: number) => Math.min(points, Number.MAX_SAFE_INTEGER);
  return Object.fromEntries(own.map(slot => {
    const [least, most] = typeof slot.ppUsed === 'number' ? [slot.ppUsed, slot.ppUsed] : [Math.min(...slot.ppUsed), Math.max(...slot.ppUsed)];
    // A charge move prints its move line on both turns, and the first generations spend the PP once: a range.
    const charges = !!mon.side.battle.gen.moves.get(slot.name)?.flags?.charge;
    const range: [number, number] = [finite(charges ? Math.ceil(least / 2) : least), finite(most)];
    return [slot.name, range[0] === range[1] ? range[0] : range];
  }));
}

/** A factor the race cannot price: a lowerer on the second mover, in Generation 1 a stage on the first. */
export function speedContaminatedAt(state: ParserState, ident: string, role: 'first' | 'second'): boolean {
  const { battle } = state;
  const mon = battle.getPokemon(ident as ClientIdent);
  if (!mon) return true;
  if ((battle.field.pseudoWeather as Record<string, unknown>)['trickroom']) return true;
  if (state.switchedThisTurn.has(ident)) return true;
  if (role === 'first') return state.genNum === 1 && (mon.boosts.spe ?? 0) > 0;
  return mon.status === 'par' || (mon.boosts.spe ?? 0) < 0;
}

/** Every opposite-side pair of the turn's movers in action order is a race the earlier won (doubles: four movers). */
export function flushSpeedOrder(state: ParserState) {
  const movers = state.turnMovers;
  for (let i = 0; i < movers.length; i++) {
    for (let j = i + 1; j < movers.length; j++) {
      const first = movers[i];
      const second = movers[j];
      if (first.side === second.side || !first.species || !second.species) continue;
      if (!first.cleanFirst || !second.cleanSecond) continue;
      if (state.reordered.has(first.ident) || state.reordered.has(second.ident)) continue;
      const { effects: secondSpeed, lowered } = raceEffects(state, second.mon, first.seen);
      if (lowered) continue;
      const { effects: firstSpeed } = raceEffects(state, first.mon, first.seen);
      state.speedOrders.push({
        firstSide: first.side, firstSpecies: first.species,
        secondSide: second.side, secondSpecies: second.species,
        turn: state.speedTurn,
        ...(firstSpeed ? { firstSpeed } : {}),
        ...(secondSpeed ? { secondSpeed } : {}),
      });
    }
  }
  state.turnMovers = [];
  state.switchedThisTurn = new Set();
  state.actedThisTurn = new Set();
  state.reordered = new Set();
  state.quickActed = new Set();
}
