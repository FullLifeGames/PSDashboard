import { statIds } from '../rules-dex.ts';
import type { ParadoxReading, StatId } from '../types.ts';
import type { SpreadCandidate } from './ladder.ts';
import { calcPokemon, keyOf, SPEED_VIOLATION_PENALTY, type SolveContext } from './fit.ts';
import { defenderSideOf } from './observation-read.ts';

/** A body that contradicts the stat the log names is as wrong as one that breaks a proved move order: the log showed it, the rolls only bound it. */
const PARADOX_VIOLATION_PENALTY = SPEED_VIOLATION_PENALTY;

/** The stats a stage and a nature can raise, in the order of the game's stat list (the order that settles a tie). */
const BOOSTABLE = statIds().filter(stat => stat !== 'hp') as StatId[];

/** A stat at a stage as the simulator's `getStat` reads it: x(2 + n)/2 above zero, x2/(2 + n) below, rounded down, six stages at most. */
function stagedStat(stat: number, stage: number): number {
  const clamped = Math.max(-6, Math.min(6, stage));
  return clamped >= 0 ? Math.floor(stat * (2 + clamped) / 2) : Math.floor(stat / ((2 + -clamped) / 2));
}

/**
 * The stat Protosynthesis and Quark Drive raise: the simulator's `getBestStat(false, true)`, the highest stat with its stages
 * and without item or ability modifiers, the first of the game's stat order on a tie (round 69, T167).
 */
export function boostedStatOf(stats: Record<string, number>, stages: Record<string, number>): StatId {
  let best = BOOSTABLE[0];
  let bestValue = 0;
  for (const stat of BOOSTABLE) {
    const value = stagedStat(stats[stat] ?? 0, stages[stat] ?? 0);
    if (value > bestValue) {
      best = stat;
      bestValue = value;
    }
  }
  return best;
}

/** One activation the mon's observations show: the forme it wore, the stat the log named and the stages it was chosen at. */
interface Activation extends ParadoxReading {
  side: 'p1' | 'p2';
  species: string;
  forme?: string;
}

function activationsOf(ctx: SolveContext, key: string): Map<string, Activation> {
  const found = new Map<string, Activation>();
  for (const obs of ctx.byMon.get(key) ?? []) {
    const roles = [
      { reading: obs.attackerParadox, side: obs.attackerSide, species: obs.attackerSpecies, forme: obs.attackerForme },
      { reading: obs.defenderParadox, side: defenderSideOf(obs), species: obs.defenderSpecies, forme: obs.defenderForme },
    ];
    for (const { reading, side, species, forme } of roles) {
      if (!reading || keyOf(side, species) !== key) continue;
      found.set(JSON.stringify([forme ?? '', reading.stat, reading.stages]), { ...reading, side, species, forme });
    }
  }
  return found;
}

/**
 * The price of a body against the stat the log named when the mon's Protosynthesis or Quark Drive activated: one violation for
 * each distinct activation whose best stat, at the stages it had there, is another stat than the named one.
 */
export function paradoxError(ctx: SolveContext, key: string, candidate: SpreadCandidate): number {
  let violations = 0;
  for (const activation of activationsOf(ctx, key).values()) {
    const stats = calcPokemon(ctx, activation.side, activation.species, candidate, { forme: activation.forme }).rawStats as unknown as Record<string, number>;
    if (boostedStatOf(stats, activation.stages) !== activation.stat) violations += 1;
  }
  return violations * PARADOX_VIOLATION_PENALTY;
}
