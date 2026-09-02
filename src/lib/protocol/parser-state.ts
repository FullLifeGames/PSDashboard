import { Battle } from '@pkmn/client';
import { Generations, type GenerationNum } from '@pkmn/data';
import { Dex } from '@pkmn/dex';
import type { DamageObservation, HiddenPowerEvidence, SpeedOrderObservation, TurnSnapshot } from '../../types';

export const gens = new Generations(Dex);

export type ClientIdent = Parameters<Battle['getPokemon']>[0];

interface TurnMover {
  side: 'p1' | 'p2';
  species: string;
  cleanFirst: boolean;
  cleanSecond: boolean;
}

/** The pending move context: crits and multi-hits disqualify its damage. */
export interface PendingMove {
  attacker: string;
  target: string;
  moveId: string;
  crit: boolean;
  observationIndex: number | null;
  damageCount: number;
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
  // Speed-order evidence: the first two |move| lines of a singles turn prove
  // effective speed order — but only when nothing else could explain it.
  speedTurn: number;
  turnMovers: TurnMover[];
  switchedThisTurn: Set<string>;
  actedThisTurn: Set<string>;
  lastMove: PendingMove | null;
  // Take initial snapshot at turn 0 (before any turns)
  capturedInitial: boolean;
}

export function createParserState(): ParserState {
  return {
    battle: new Battle(gens),
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
    lastMove: null,
    capturedInitial: false,
  };
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

export function flushSpeedOrder(state: ParserState) {
  const [first, second] = state.turnMovers;
  if (first && second && first.cleanFirst && second.cleanSecond &&
    first.side !== second.side && first.species && second.species) {
    state.speedOrders.push({
      firstSide: first.side, firstSpecies: first.species,
      secondSide: second.side, secondSpecies: second.species,
      turn: state.speedTurn,
    });
  }
  state.turnMovers = [];
  state.switchedThisTurn = new Set();
  state.actedThisTurn = new Set();
}
