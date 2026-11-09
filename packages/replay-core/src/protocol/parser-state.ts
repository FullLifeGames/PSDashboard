import { Battle, Pokemon } from '@pkmn/client';
import type { GenerationNum } from '@pkmn/data';
import { generationsFor } from '../format-generations.ts';
import { toId } from '../ids.ts';
import type { ItemReading } from './item-reading.ts';
import type { DamageObservation, HiddenPowerEvidence, PokemonSnapshot, SpeedOrderObservation, TurnSnapshot } from '../types.ts';

export type ClientIdent = Parameters<Battle['getPokemon']>[0];

interface TurnMover {
  side: 'p1' | 'p2';
  species: string;
  ident: string;
  cleanFirst: boolean;
  cleanSecond: boolean;
}

/** A Choice Scarf that came (`held`) or went at this turn (round 63). */
export interface ScarfChange {
  turn: number;
  held: boolean;
}

/** What one target of the pending move took so far: a second damage line spoils the observation of the first (multi-hit). */
export interface TargetHit {
  count: number;
  observation: DamageObservation | null;
}

/** The pending move context: crits and multi-hits disqualify the damage of their target. */
export interface PendingMove {
  attacker: string;
  target: string;
  moveId: string;
  /** The move's name as the move line prints it (round 69, T86). */
  moveName: string;
  /** The move line names `[spread]`: the simulator cut the damage (round 69, T31). */
  spread: boolean;
  /** Targets a `|-crit|` line named: their damage is no reading. */
  crits: Set<string>;
  /** Per target ident, in the order the damage lines came (a spread move has up to three, Dragon Darts two). */
  hits: Map<string, TargetHit>;
  /** The item of a Pokémon whose item ended inside this move before its damage line: it counted for the hit (round 69, T191). */
  itemsBefore: Map<string, ItemReading>;
  /** Targets with an item or ability line inside this move before their damage line: a Focus Sash, Sturdy or Endure may hold the hit back. */
  marked: Set<string>;
  /** The attacker's speed-evidence cleanliness at move time. */
  speedClean: boolean;
  attackerSide: 'p1' | 'p2';
  attackerSpecies: string;
  /** Effectiveness marker seen for this move (HP-type evidence, ⑤). */
  effectiveness?: 'super' | 'resisted';
}

/** The scan state one replay parse carries from line to line. */
export interface ParserState {
  battle: Battle;
  snapshots: TurnSnapshot[];
  observations: DamageObservation[];
  speedOrders: SpeedOrderObservation[];
  hpEvidence: HiddenPowerEvidence[];
  currentTurnLines: string[];
  singles: boolean;
  genNum: GenerationNum;
  // Speed-order evidence: the |move| lines of a turn prove effective speed
  // order between opposite sides — but only when nothing else could
  // explain it.
  speedTurn: number;
  turnMovers: TurnMover[];
  switchedThisTurn: Set<string>;
  actedThisTurn: Set<string>;
  /** Idents whose slot After You or Quash rearranged this turn (round 37). */
  reordered: Set<string>;
  /** Idents that acted early on a Quick Claw, Quick Draw, or Custap Berry this turn (round 37). */
  quickActed: Set<string>;
  /**
   * Per `side:species`, the turns a Choice Scarf came or went (round 63):
   * the races around them are read with the Scarf the mon held, the races
   * of a change turn are dropped.
   */
  scarfChanges: Map<string, ScarfChange[]>;
  /** The stat stages each Pokémon had when its Protosynthesis or Quark Drive last activated (round 69, T167). */
  paradoxStages: Map<Pokemon, Record<string, number>>;
  /** The Pokémon whose ability a `|-endability|` line took away (Gastro Acid): the client keeps no trace of it (round 69, T86). */
  abilityEnded: Set<Pokemon>;
  lastMove: PendingMove | null;
  // Take initial snapshot at turn 0 (before any turns)
  capturedInitial: boolean;
}

/** A fresh scan state; `format` is the log's tier, which picks the Generations the client battle is built on. */
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

/**
 * Round 89 (#106): @pkmn/client 0.7.4 never charges Pressure's extra PP point: `getPressurePP` compares `effectiveAbility()`, which
 * returns an ID (`pressure`), with the name `Pressure`. The simulator charges it (a Pressure holder as the target of a move costs two
 * PP per use), so the count the log shows would stay one short per use and a move at 0 PP would read 1 PP. This copy is the client's
 * method with the comparison made on IDs; the Pressure row of `low-pp-sweep.spec.ts` holds it to the simulator. Upstream list: the
 * comparison in `Pokemon#getPressurePP`.
 */
// eslint-disable-next-line names/no-new-dex-name -- the client's own ability ID, held to the simulator by the Pressure rows of low-pp-sweep.spec.ts
const PRESSURE = 'pressure';
type PressurePP = number | [number, number];
(Pokemon.prototype as unknown as { getPressurePP(pp: PressurePP, foes: Pokemon[]): PressurePP }).getPressurePP = function (this: Pokemon, pp, foes) {
  for (const foe of foes) {
    const abilities = Object.values(this.side.battle.gen.species.get(foe.speciesForme)?.abilities ?? {}).map(toId);
    const canHavePressure = this.side.battle.gen.num === 3 && abilities.includes(PRESSURE);
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

/**
 * Round 89 (#106): the PP the log shows spent per move of the body, as @pkmn/client counts it (`ppUsed` of its move slots, which
 * charges Pressure and takes a Leppa or Mystery Berry back off). The copies a Transform holds are the target's moves and stay out;
 * a pair is a range: the client's when the foe's Pressure is open, and a charge move's, whose second move line some generations
 * do not charge. Undefined when the body shows no move.
 */
export function ppUsedOf(mon: Pokemon): PokemonSnapshot['ppUsed'] {
  const own = mon.moveSlots.filter(slot => !slot.virtual);
  if (own.length === 0) return undefined;
  // Grudge empties a move: the client counts Infinity, which a JSON snapshot would turn into null.
  const finite = (points: number) => Math.min(points, Number.MAX_SAFE_INTEGER);
  return Object.fromEntries(own.map(slot => {
    const [least, most] = typeof slot.ppUsed === 'number' ? [slot.ppUsed, slot.ppUsed] : [Math.min(...slot.ppUsed), Math.max(...slot.ppUsed)];
    // A charge move prints its move line on both turns, and the first generations spend the PP once: the count is a range there.
    const charges = !!mon.side.battle.gen.moves.get(slot.name)?.flags?.charge;
    const range: [number, number] = [finite(charges ? Math.ceil(least / 2) : least), finite(most)];
    return [slot.name, range[0] === range[1] ? range[0] : range];
  }));
}

/**
 * DIRECTIONAL contamination, read at decision time: an observation drops
 * only when the factor could EXPLAIN the observed order — a speed-RAISING
 * factor (Tailwind, +spe stages, paradox boosters) on the FIRST mover, or
 * a speed-LOWERING factor (paralysis, −spe stages) on the SECOND. The
 * kept directions are IMPLIED constraints: outrunning a Tailwind-doubled
 * opponent outruns its base speed a fortiori, and a paralyzed mon moving
 * first won the race at a quarter of its speed. Trick Room inverts order
 * outright and same-turn entries are unknowable at order time — both
 * stay bilateral. (Paradox boosters are VOLATILES, not stat stages; any
 * variant counts as a raiser and none as a lowerer.)
 */
export function speedContaminatedAt(state: ParserState, ident: string, role: 'first' | 'second'): boolean {
  const { battle } = state;
  const mon = battle.getPokemon(ident as ClientIdent);
  if (!mon) return true;
  if ((battle.field.pseudoWeather as Record<string, unknown>)['trickroom']) return true;
  if (state.switchedThisTurn.has(ident)) return true;
  if (role === 'first') {
    const side = ident.startsWith('p1') ? battle.p1 : battle.p2;
    const paradox = Object.keys((mon.volatiles ?? {}) as Record<string, unknown>)
      .some(key => /^(protosynthesis|quarkdrive)/.test(key));
    return paradox || (mon.boosts.spe ?? 0) > 0 ||
      !!(side.sideConditions as Record<string, unknown>)['tailwind'];
  }
  return mon.status === 'par' || (mon.boosts.spe ?? 0) < 0;
}

/**
 * Every opposite-side pair of the turn's movers in action order is a
 * race the earlier one won (round 37: doubles turns carry up to four
 * movers; a singles turn still yields its one pair). A pair drops when
 * the earlier mover is not clean as a first mover, the later one not as
 * a second, or either slot was rearranged.
 */
export function flushSpeedOrder(state: ParserState) {
  const movers = state.turnMovers;
  for (let i = 0; i < movers.length; i++) {
    for (let j = i + 1; j < movers.length; j++) {
      const first = movers[i];
      const second = movers[j];
      if (first.side === second.side || !first.species || !second.species) continue;
      if (!first.cleanFirst || !second.cleanSecond) continue;
      if (state.reordered.has(first.ident) || state.reordered.has(second.ident)) continue;
      state.speedOrders.push({
        firstSide: first.side, firstSpecies: first.species,
        secondSide: second.side, secondSpecies: second.species,
        turn: state.speedTurn,
      });
    }
  }
  state.turnMovers = [];
  state.switchedThisTurn = new Set();
  state.actedThisTurn = new Set();
  state.reordered = new Set();
  state.quickActed = new Set();
}
